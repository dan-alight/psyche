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
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <unordered_map>

#include "plugin.h"

namespace psyche {

#if defined(_WIN32)
using PluginLibPtr = HMODULE;
#else
using PluginLibPtr = void*;
#endif

enum class PluginLoadStatus {
  kSuccess,
  kAlreadyLoaded,
  kFileNotFound,
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

struct PluginFullContext {
  std::string dir;
  PluginLanguage language;
  PluginType type;
  PluginLibPtr ptr = nullptr;
  Plugin* plugin;
  std::shared_mutex mut;
  std::shared_ptr<bool> initialized = std::make_shared<bool>(false);
  bool alive = true;

  PluginFullContext(
      const std::string& dir,
      PluginLanguage language,
      PluginType type,
      Plugin* plugin,
      PluginLibPtr ptr)
      : dir(dir),
        language(language),
        type(type),
        ptr(ptr),
        plugin(plugin) {
  }
  PluginFullContext(
      const std::string& dir,
      PluginLanguage language,
      PluginType type,
      Plugin* plugin)
      : dir(dir),
        language(language),
        type(type),
        plugin(plugin) {
  }
};

struct PluginExecutionContext {
  Plugin* plugin;
  std::shared_lock<std::shared_mutex> lock;
  PluginLanguage language;
  PluginType type;
  std::weak_ptr<bool> initialized;

  PluginExecutionContext(PluginFullContext& ctx)
      : plugin(ctx.plugin),
        lock(ctx.mut),
        language(ctx.language),
        type(ctx.type),
        initialized(ctx.initialized) {
  }

  Plugin* operator->() const {
    return plugin;
  }
  Plugin& operator*() const {
    return *plugin;
  }
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
  PluginLoadStatus Load(const std::string& dir);
  // PluginLoadStatus Load(const std::string& dir);
  PluginUnloadStatus Unload(const std::string& name);
  // void SetPluginsDir(const std::string& dir);
  bool IsLoaded(const std::string& name);
  std::optional<PluginExecutionContext> GetPlugin(const std::string& name);
  void DisablePluginAccess(const std::string& name);

 private:
  PluginManager() = default;
  ~PluginManager() = default;

  // std::string plugins_dir_;
  std::unordered_map<std::string, std::unique_ptr<PluginFullContext>> loaded_plugins_;
  bool loaded_plugins_available_ = true;
  std::shared_mutex loaded_plugins_mut_;
};

}  // namespace psyche

#endif  // PSYCHE_PLUGIN_MANAGER_H_
