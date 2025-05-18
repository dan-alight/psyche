#ifndef PSYCHE_PLUGIN_H_
#define PSYCHE_PLUGIN_H_

#include <memory>
#include <optional>
#include <string>

#include "host_interface.h"

namespace psyche {

enum class PluginType {
  kAgent,
  kResource,
};

class Plugin {
 public:
  virtual ~Plugin() = default;
  virtual void Uninitialize() = 0;
  virtual void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) = 0;
  virtual void StopStream(int64_t channel_id) = 0;

};
}  // namespace psyche
#endif  // PSYCHE_PLUGIN_H_
