#include "plugin_manager.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>

#include "agent.h"
#include "plugin.h"
#include "pybind11/pybind11.h"
#include "rapidjson/document.h"
#include "utils.h"

namespace psyche {
namespace py = pybind11;
PluginLoadStatus PluginManager::Load(const std::string& name, PluginType type) {
  if (IsLoaded(name)) {
    return PluginLoadStatus::kAlreadyLoaded;
  }
  std::string type_str;
  if (type == PluginType::kAgent) {
    type_str = "agents";
  } else {
    type_str = "resources";
  }

  std::string plugin_dir =
      plugins_dir_ +
      "/" + type_str +
      "/" + name;

  std::string info_path = plugin_dir + "/info.json";
  std::ifstream file(info_path);
  std::ostringstream ss;
  ss << file.rdbuf();
  rapidjson::Document doc;
  doc.Parse(ss.str().c_str());
  auto* language = doc["language"].GetString();

  if (std::strcmp(language, "cpp") == 0) {
    return LoadCpp(name, plugin_dir);
  } else {
    return LoadPython(name, plugin_dir);
  }
}

PluginUnloadStatus PluginManager::Unload(const std::string& name) {
  auto it = loaded_plugins_.find(name);
  if (it == loaded_plugins_.end()) {
    return PluginUnloadStatus::kNotLoaded;
  }

  // Necessary to deal with callbacks that have been registered to the MessageProcessor
  // that will be made invalid after this.

  PluginData& plugin_data = it->second;
  Plugin* instance = plugin_data.instance;
  PluginHandle handle = plugin_data.handle;
  if (plugin_data.language == PluginLanguage::kCpp) {
    instance->Uninitialize();
    loaded_plugins_.erase(it);
    delete instance;

#if defined(_WIN32)
    if (!FreeLibrary(handle)) {
      return PluginUnloadStatus::kUnloadError;
    }
#else
    if (dlclose(handle) != 0) {
      return PluginUnloadStatus::kUnloadError;
    }
#endif

  } else {
    return PluginUnloadStatus::kUnloadError;
  }

  return PluginUnloadStatus::kSuccess;
}

void PluginManager::SetPluginsDir(const std::string& dir) {
  plugins_dir_ = dir;
}

bool PluginManager::IsLoaded(const std::string& name) {
  return loaded_plugins_.contains(name);
}

Plugin* PluginManager::GetPlugin(const std::string& name) {
  return loaded_plugins_[name].instance;
}

PluginLoadStatus PluginManager::LoadCpp(const std::string& name, const std::string& dir) {
  using PluginFactory = Plugin* (*)();
  std::string plugin_path_without_extension = dir + "/" + name;
  std::string full_path;
#if defined(_WIN32)
  full_path = plugin_path_without_extension + ".dll";

  UINT prev_mode = SetErrorMode(SEM_FAILCRITICALERRORS);
  PluginHandle handle = LoadLibrary(full_path.c_str());
  SetErrorMode(prev_mode);

  if (handle == nullptr) {
    DWORD error = GetLastError();
    if (error == ERROR_FILE_NOT_FOUND) {
      return PluginLoadStatus::kFileNotFound;
    }
    return PluginLoadStatus::kLoadError;
  }

  // Get the GetPluginInstance function pointer
  PluginFactory plugin_factory =
      reinterpret_cast<PluginFactory>(GetProcAddress(handle, "GetPluginInstance"));

  if (!plugin_factory) {
    FreeLibrary(handle);
    return PluginLoadStatus::kInvalidPlugin;
  }

  // Create the plugin instance
  Plugin* plugin_instance = plugin_factory();
  if (!plugin_instance) {
    FreeLibrary(handle);
    return PluginLoadStatus::kInvalidPlugin;
  }
#else
#if defined(__APPLE__)
  full_path = plugin_path_without_extension + ".dylib";
#elif defined(__linux__)
  full_path = plugin_path_without_extension + ".so";
#endif
  dlerror();

  PluginHandle handle = dlopen(full_path.c_str(), RTLD_NOW | RTLD_LOCAL);

  if (handle == nullptr) {
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
      reinterpret_cast<PluginFactory>(dlsym(handle, "GetPluginInstance"));

  if (!plugin_factory) {
    dlclose(handle);
    return PluginLoadStatus::kInvalidPlugin;
  }

  // Create the plugin instance
  Plugin* plugin_instance = plugin_factory();
  if (!plugin_instance) {
    dlclose(handle);
    return PluginLoadStatus::kInvalidPlugin;
  }
#endif

  // Store both the handle and the plugin instance
  loaded_plugins_[name] = {
    PluginLanguage::kCpp, handle, plugin_instance};

  return PluginLoadStatus::kSuccess;
}

PluginLoadStatus PluginManager::LoadPython(const std::string& name, const std::string& dir) {
  py::gil_scoped_acquire gil;
  py::module_ sys = py::module_::import("sys");
  py::module_ importlib = py::module_::import("importlib");
  py::module_ os = py::module_::import("os");

  std::string venv_path = dir + "/venv";
  if (!std::filesystem::exists(venv_path)) {
    std::string command = "python -m venv " + venv_path;
    std::system(command.c_str());
  }
  std::string requirements_file = dir + "/requirements.txt";
  if (std::filesystem::exists(requirements_file)) {
#if defined(_WIN32)
    std::string command = venv_path + "/Scripts/pip install -r " + requirements_file + " -v";
#else
    std::string command = venv_path + "/bin/pip install -r " + requirements_file + " -v";
#endif
    std::system(command.c_str());
  }

  // When each plugin has a sub-interpreter, don't need to worry about sys.path clutter
  std::string parent_dir = std::filesystem::path(dir).parent_path().string();
  std::string site_packages = venv_path + "/lib/site-packages";
  py::list sys_path = sys.attr("path").cast<py::list>();
  sys_path.append(parent_dir);
  sys_path.append(site_packages);
  py::module_ mod = py::module_::import(name.c_str());

  py::object plugin_class = mod.attr(SnakeToPascal(name).c_str());
  py::object instance = plugin_class();

  auto* ptr = instance.cast<std::unique_ptr<Plugin>>().release();

  loaded_plugins_[name] = {PluginLanguage::kPython, nullptr, ptr};
  return PluginLoadStatus::kSuccess;
}

}  // namespace psyche
