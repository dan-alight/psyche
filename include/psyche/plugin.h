#ifndef PSYCHE_PLUGIN_H_
#define PSYCHE_PLUGIN_H_

#include <memory>
#include <optional>
#include <string>

#include "host_interface.h"

namespace psyche {

enum class PluginInitializeStatus {
  kSuccess,
  kError,
};

enum class PluginType {
  kAgent,
  kResource,
};

class Plugin {
 public:
  virtual ~Plugin() = default;
  // Might contain a "name" field that would be used in the "from" field of Messages
  // (Could make it so a JSON file in plugin folder gets precedence over this function return)
  virtual std::string GetPluginInfo() = 0;

  virtual void Uninitialize() = 0;

  // every single plugin does the following:
  // perform some computation and provide some data to an agent channel
  // OR perform some computation without providing data to a channel
  // all data should follow a precise format defined by the plugin info
  virtual void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) = 0;
  virtual void StopStream(int64_t channel_id) = 0;

};
}  // namespace psyche
#endif  // PSYCHE_PLUGIN_H_
