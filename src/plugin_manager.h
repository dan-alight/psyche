#ifndef PSYCHE_PLUGIN_MANAGER_H_
#define PSYCHE_PLUGIN_MANAGER_H_

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

#include "plugin.h"

namespace psyche {

#if defined(_WIN32)
using PluginHandle = HMODULE;
#else
using PluginHandle = void*;
#endif

enum class PluginLoadStatus {
  kSuccess,
  kAlreadyLoaded,
  kFileNotFound,
  kLoadError,
  kInvalidPlugin,
};

enum class PluginUnloadStatus {
  kSuccess,
  kNotLoaded,
  kUnloadError,
};

enum class PluginLanguage {
  kCpp,
  kPython
};

struct PluginData {
  PluginLanguage language;
  PluginHandle handle;
  Plugin* instance;
};

// Just loads/unloads and keeps track of plugins. Is not concerned with plugin semantics/validity.
class PluginManager {
 public:
  PluginManager(const PluginManager&) = delete;
  PluginManager& operator=(const PluginManager&) = delete;
  static PluginManager& Get() {
    static PluginManager& instance = *new PluginManager();
    return instance;
  }
  PluginLoadStatus Load(const std::string& name, PluginType type);
  PluginUnloadStatus Unload(const std::string& name);
  void SetPluginsDir(const std::string& dir);
  bool IsLoaded(const std::string& name);
  Plugin* GetPlugin(const std::string& name);

 private:
  PluginManager() = default;
  ~PluginManager() = default;
  PluginLoadStatus LoadCpp(const std::string& name, const std::string& dir);
  PluginLoadStatus LoadPython(const std::string& name, const std::string& dir);

  std::string plugins_dir_;
  std::unordered_map<std::string, PluginData> loaded_plugins_;
};

}  // namespace psyche

#endif  // PSYCHE_PLUGIN_MANAGER_H_
