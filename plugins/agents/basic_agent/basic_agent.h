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
class BasicAgent : public Agent {
 public:
  void Initialize(AgentInterface agent_interface) override;
  void Uninitialize() override;
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) override;
  void StopStream(int64_t channel_id) override;
  void PluginAdded(std::string plugin_info) override;
  void PluginRemoved(std::string name) override;

 private:
  AgentInterface interface_;
  std::vector<int64_t> receiving_channels_;

  void ReceiveChatInput(Payload payload);
};
PSYCHE_REGISTER_PLUGIN(BasicAgent)
}  // namespace psyche

#endif