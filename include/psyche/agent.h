#ifndef PSYCHE_AGENT_H
#define PSYCHE_AGENT_H

#include "plugin.h"

namespace psyche {

class Agent : public Plugin {
 public:
  virtual ~Agent() = default;
  virtual PluginInitializeStatus Initialize(AgentInterface agent_interface) = 0;
  virtual void PluginAdded(std::string plugin_info) = 0;
  virtual void PluginRemoved(std::string name) = 0;
};

}  // namespace psyche

#endif
