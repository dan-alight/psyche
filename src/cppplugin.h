#ifndef PSYCHE_CPPPLUGIN_H_
#define PSYCHE_CPPPLUGIN_H_

#include <memory>

#include "agent.h"

namespace psyche {
/* class CppPlugin : public Plugin {

}; */

class CppAgent : public Agent {
 public:
  CppAgent(std::unique_ptr<Agent> agent);
  void Uninitialize() override;
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) override;
  void StopStream(int64_t channel_id) override;
  void Initialize(AgentInterface agent_interface) override;
  void PluginAdded(std::string plugin_info) override;
  void PluginRemoved(std::string name) override;

 private:
  std::unique_ptr<Agent> agent_;
};

}  // namespace psyche

#endif