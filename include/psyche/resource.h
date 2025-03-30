#ifndef PSYCHE_RESOURCE_H_
#define PSYCHE_RESOURCE_H_

#include "plugin.h"

namespace psyche {

class Resource : public Plugin {
 public:
  virtual ~Resource() = default;
  virtual PluginInitializeStatus Initialize(ResourceInterface resource_interface) = 0;
};

}  // namespace psyche
#endif  // PSYCHE_RESOURCE_H_
