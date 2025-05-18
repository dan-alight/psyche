#include "cppplugin.h"

namespace psyche {
CppAgent::CppAgent(std::unique_ptr<Agent> agent) {
  agent_ = std::move(agent);
}

void CppAgent::Uninitialize() {
  agent_->Uninitialize();
}
void CppAgent::Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) {
  agent_->Invoke(channel_id, std::move(data), aux);
}
void CppAgent::StopStream(int64_t channel_id) {
  agent_->StopStream(channel_id);
}
void CppAgent::Initialize(AgentInterface agent_interface) {
  agent_->Initialize(std::move(agent_interface));
}
void CppAgent::PluginAdded(std::string plugin_info) {
  agent_->PluginAdded(std::move(plugin_info));
}
void CppAgent::PluginRemoved(std::string name) {
  agent_->PluginRemoved(std::move(name));
}

}  // namespace psyche