#ifndef PSYCHE_DEFAULT_AGENT_H_
#define PSYCHE_DEFAULT_AGENT_H_

#include <cstring>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "agent.h"
#include "plugin.h"
#include "plugin_registrar.h"
#include "rapidjson/document.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace psyche {
class DefaultAgent : public Agent {
 public:
  std::string GetPluginInfo();
  PluginInitializeStatus Initialize(AgentInterface agent_interface);
  void Uninitialize();
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux);
  void StopStream(int64_t channel_id);
  void PluginAdded(std::string plugin_info);
  void PluginRemoved(std::string name);

 private:
  AgentInterface interface_;
  std::vector<int64_t> receiving_channels_;

  void ReceiveChatInput(Payload payload);
};
PSYCHE_REGISTER_PLUGIN(DefaultAgent)
}  // namespace psyche

#endif