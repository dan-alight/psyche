#include "plugin_manager.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <shared_mutex>
#include <sstream>

#include "agent.h"
#include "cppplugin.h"
#include "plugin.h"
#include "pybind11/pybind11.h"
#include "rapidjson/document.h"
#include "spdlog/spdlog.h"
#include "utils.h"

namespace psyche {
namespace py = pybind11;

namespace {
void RemovePythonPackage(const std::string& dir) {
  std::string name = dir.substr(dir.find_last_of("/\\") + 1);

  py::gil_scoped_acquire gil;
  py::module_ sys = py::module_::import("sys");
  py::dict modules = sys.attr("modules");
  std::vector<std::string> to_remove;
  for (auto& item : modules) {
    std::string modname = py::str(item.first);
    if (modname == name || modname.rfind(name + ".", 0) == 0) {
      to_remove.push_back(modname);
    }
  }
  for (const auto& modname : to_remove) {
    modules.attr("pop")(modname);
  }

  std::string parent_dir = std::filesystem::path(dir).parent_path().string();
  std::string venv_path = dir + "/venv";
  std::string site_packages = venv_path + "/lib/site-packages";
  py::list sys_path = sys.attr("path").cast<py::list>();

#if defined(_WIN32)
  sys_path.attr("remove")(venv_path + "/Lib/site-packages/win32");
  sys_path.attr("remove")(venv_path + "/Lib/site-packages/win32/lib");
#endif
  sys_path.attr("remove")(parent_dir);
  sys_path.attr("remove")(site_packages);

  // Optionally: force garbage collection
  py::module_ gc = py::module_::import("gc");
  gc.attr("collect")();
}
}  // namespace

PluginLoadStatus PluginManager::Load(const std::string& dir) {
  std::string info_path = dir + "/info.json";
  std::ifstream file(info_path);
  if (!file.is_open()) {
    spdlog::error("Plugin info.json missing: {}", info_path);
    return PluginLoadStatus::kFileNotFound;
  }

  std::ostringstream ss;
  ss << file.rdbuf();
  std::string json_str = ss.str();

  rapidjson::Document doc;
  doc.Parse(json_str.c_str());
  if (doc.HasParseError()) {
    spdlog::error("Failed to parse plugin info.json: error code {}", static_cast<int>(doc.GetParseError()));
    return PluginLoadStatus::kInvalidPlugin;
  }

  if (!doc.IsObject()) {
    spdlog::error("Plugin info.json is not a JSON object");
    return PluginLoadStatus::kInvalidPlugin;
  }

  if (!doc.HasMember("name") || !doc["name"].IsString()) {
    spdlog::error("Plugin info.json missing 'name' or 'name' is not a string");
    return PluginLoadStatus::kInvalidPlugin;
  }
  const char* name = doc["name"].GetString();

  if (IsLoaded(name)) {
    return PluginLoadStatus::kAlreadyLoaded;
  }

  if (!doc.HasMember("language") || !doc["language"].IsString()) {
    spdlog::error("Plugin info.json missing 'language' or 'language' is not a string");
    return PluginLoadStatus::kInvalidPlugin;
  }
  const char* language = doc["language"].GetString();

  if (!doc.HasMember("type") || !doc["type"].IsString()) {
    spdlog::error("Plugin info.json missing 'type' or 'type' is not a string");
    return PluginLoadStatus::kInvalidPlugin;
  }
  const char* type_str = doc["type"].GetString();

  PluginType type;
  if (std::strcmp(type_str, "agent") == 0) {
    type = PluginType::kAgent;
  } else if (std::strcmp(type_str, "resource") == 0) {
    type = PluginType::kResource;
  } else {
    spdlog::error("Plugin info.json has invalid 'type': {}", type_str);
    return PluginLoadStatus::kInvalidPlugin;
  }

  if (std::strcmp(language, "cpp") == 0) {
    using PluginFactory = Plugin* (*)();
    std::string plugin_path_without_extension = dir + "/" + name;
    std::string full_path;
#if defined(_WIN32)
    full_path = plugin_path_without_extension + ".dll";

    UINT prev_mode = SetErrorMode(SEM_FAILCRITICALERRORS);
    PluginLibPtr lib_ptr = LoadLibrary(full_path.c_str());
    SetErrorMode(prev_mode);

    if (lib_ptr == nullptr) {
      DWORD error = GetLastError();
      if (error == ERROR_FILE_NOT_FOUND) {
        return PluginLoadStatus::kFileNotFound;
      }
      return PluginLoadStatus::kInvalidPlugin;
    }

    // Get the GetPluginInstance function pointer
    PluginFactory plugin_factory =
        reinterpret_cast<PluginFactory>(GetProcAddress(lib_ptr, "GetPluginInstance"));

    if (!plugin_factory) {
      FreeLibrary(lib_ptr);
      return PluginLoadStatus::kInvalidPlugin;
    }

    // Create the plugin instance
    Plugin* plugin = plugin_factory();
    if (!plugin) {
      FreeLibrary(lib_ptr);
      return PluginLoadStatus::kInvalidPlugin;
    }
#else
#if defined(__APPLE__)
    full_path = plugin_path_without_extension + ".dylib";
#elif defined(__linux__)
    full_path = plugin_path_without_extension + ".so";
#endif
    dlerror();

    PluginLibPtr lib_ptr = dlopen(full_path.c_str(), RTLD_NOW | RTLD_LOCAL);

    if (lib_ptr == nullptr) {
      const char* error = dlerror();
      // Who knows what the actual error string is
      if (strstr(error, "No such file") ||
          strstr(error, "cannot open shared object file")) {
        return PluginLoadStatus::kFileNotFound;
      }
      return PluginLoadStatus::kLoadError;
    }

    // Get the GetPluginInstance function pointer
    PluginFactory plugin_factory =
        reinterpret_cast<PluginFactory>(dlsym(lib_ptr, "GetPluginInstance"));

    if (!plugin_factory) {
      dlclose(lib_ptr);
      return PluginLoadStatus::kInvalidPlugin;
    }

    // Create the plugin instance
    Plugin* plugin = plugin_factory();
    if (!plugin) {
      dlclose(lib_ptr);
      return PluginLoadStatus::kInvalidPlugin;
    }
#endif

    loaded_plugins_.emplace(
        name,
        std::make_unique<PluginFullContext>(dir, PluginLanguage::kCpp, type, plugin, lib_ptr));

  } else if (std::strcmp(language, "python") == 0) {
    py::gil_scoped_acquire gil;
    py::module_ importlib = py::module_::import("importlib");
    py::module_ os = py::module_::import("os");
    py::module_ sys = py::module_::import("sys");
    std::string venv_path = dir + "/venv";
    if (!std::filesystem::exists(venv_path)) {
      std::string command = "python -m venv " + venv_path;
      std::system(command.c_str());
    }
    std::string requirements_file = dir + "/requirements.txt";
    if (std::filesystem::exists(requirements_file)) {
      std::string marker_file = venv_path + "/.deps_installed";
      if (!std::filesystem::exists(marker_file) ||
          std::filesystem::last_write_time(requirements_file) > std::filesystem::last_write_time(marker_file)) {
        std::ofstream(marker_file).put('1');

#if defined(_WIN32)
        std::string command = venv_path + "/Scripts/pip install -r " + requirements_file + " -v";
#else
        std::string command = venv_path + "/bin/pip install -r " + requirements_file + " -v";
#endif
        std::system(command.c_str());
      }
    }

    std::string parent_dir = std::filesystem::path(dir).parent_path().string();
    std::string site_packages = venv_path + "/lib/site-packages";
    py::list sys_path = sys.attr("path").cast<py::list>();
    sys_path.insert(0, parent_dir);
    sys_path.insert(0, site_packages);
#if defined(_WIN32)
    sys_path.insert(0, venv_path + "/Lib/site-packages/win32/lib");
    sys_path.insert(0, venv_path + "/Lib/site-packages/win32");
#endif

    try {
      py::module_ mod = py::module_::import(name);
      py::object plugin_class = mod.attr(SnakeToPascal(name).c_str());
      py::object instance = plugin_class();

      Plugin* plugin = instance.cast<std::unique_ptr<Plugin>>().release();
      loaded_plugins_.emplace(
          name,
          std::make_unique<PluginFullContext>(dir, PluginLanguage::kPython, type, plugin));
    } catch (const py::error_already_set& e) {
      spdlog::error("Error loading Python plugin: {}", e.what());
      RemovePythonPackage(dir);
      return PluginLoadStatus::kInvalidPlugin;
    }
  } else {
    spdlog::error("Plugin info.json has invalid 'language': {}", language);
    return PluginLoadStatus::kInvalidPlugin;
  }
  return PluginLoadStatus::kSuccess;
}

PluginUnloadStatus PluginManager::Unload(const std::string& name) {
  auto it = loaded_plugins_.find(name);
  if (it == loaded_plugins_.end()) {
    return PluginUnloadStatus::kNotLoaded;
  }

  PluginFullContext& ctx = *it->second;
  Plugin* plugin = ctx.plugin;

  if (ctx.language == PluginLanguage::kCpp) {
    delete plugin;
    PluginLibPtr ptr = ctx.ptr;

#if defined(_WIN32)
    if (!FreeLibrary(ptr)) {
      return PluginUnloadStatus::kUnloadError;
    }
#else
    if (dlclose(ptr) != 0) {
      return PluginUnloadStatus::kUnloadError;
    }
#endif
  } else {
    // Unload Python plugin
    try {
      py::gil_scoped_acquire gil;
      delete plugin;
      RemovePythonPackage(ctx.dir);
    } catch (const py::error_already_set& e) {
      spdlog::error("Error unloading Python plugin: {}", e.what());
      return PluginUnloadStatus::kUnloadError;
    }
  }
  loaded_plugins_available_ = false;
  std::unique_lock lock(loaded_plugins_mut_);
  loaded_plugins_available_ = true;
  loaded_plugins_.erase(it);

  return PluginUnloadStatus::kSuccess;
}

bool PluginManager::IsLoaded(const std::string& name) {
  return loaded_plugins_.contains(name);
}

std::optional<PluginExecutionContext> PluginManager::GetPlugin(const std::string& name) {
  if (!loaded_plugins_available_) return {};
  std::shared_lock lock(loaded_plugins_mut_);
  auto it = loaded_plugins_.find(name);
  if (it == loaded_plugins_.end()) return {};

  auto& ctx = *it->second;
  if (!ctx.alive) return {};

  return PluginExecutionContext(ctx);
}

void PluginManager::DisablePluginAccess(const std::string& name) {
  loaded_plugins_available_ = false;  // Prevent starvation
  std::unique_lock lock(loaded_plugins_mut_);
  loaded_plugins_available_ = true;
  auto it = loaded_plugins_.find(name);
  if (it == loaded_plugins_.end()) return;
  auto& ctx = *it->second;
  ctx.alive = false;
}

}  // namespace psyche
