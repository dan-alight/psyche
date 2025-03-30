#ifndef PSYCHE_REGISTER_PLUGIN_H_
#define PSYCHE_REGISTER_PLUGIN_H_

#include "plugin.h"

namespace psyche {

using PluginFactory = Plugin* (*)();
inline PluginFactory registered_factory = nullptr;

class PluginRegistrar {
 public:
  PluginRegistrar(PluginFactory factory) {
    registered_factory = factory;
  }
};

#if defined(_WIN32)
#define PSYCHE_EXPORT __declspec(dllexport)
#define PSYCHE_CALL __cdecl
#else
#define PSYCHE_EXPORT __attribute__((visibility("default")))
#define PSYCHE_CALL
#endif
extern "C" PSYCHE_EXPORT Plugin* PSYCHE_CALL GetPluginInstance() {
  return registered_factory ? registered_factory() : nullptr;
}
#undef PSYCHE_EXPORT
#undef PSYCHE_CALL

#define PSYCHE_REGISTER_PLUGIN(PluginClass) \
  Plugin* Create##PluginClass() {           \
    return new PluginClass();               \
  }                                         \
  PluginRegistrar registrar_##PluginClass(Create##PluginClass);

}  // namespace psyche

#endif
