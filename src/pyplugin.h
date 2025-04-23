#ifndef PSYCHE_PYPLUGIN_H_
#define PSYCHE_PYPLUGIN_H_

#include <iostream>
#include <string>
#include <type_traits>

#include "agent.h"
#include "asyncio_loop.h"
#include "pybind11/embed.h"
#include "pybind11/pybind11.h"
#include "pybind11/stl.h"
#include "resource.h"

namespace psyche {
namespace py = pybind11;

class PyPlugin : public Plugin, public py::trampoline_self_life_support {
 public:
  void SetLoop(std::shared_ptr<AsyncioLoop> asyncio_loop) {
    asyncio_loop_ = asyncio_loop;
  }
  std::string GetPluginInfo() override;
  void Uninitialize() override;
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) override;
  void StopStream(int64_t channel_id) override;

 private:
  std::shared_ptr<AsyncioLoop> asyncio_loop_;
};

class PyAgent : public Agent, public py::trampoline_self_life_support {
 public:
  void SetLoop(std::shared_ptr<AsyncioLoop> asyncio_loop) {
    asyncio_loop_ = asyncio_loop;
  }
  std::string GetPluginInfo() override;
  void Uninitialize() override;
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) override;
  void StopStream(int64_t channel_id) override;
  PluginInitializeStatus Initialize(AgentInterface agent_interface) override;
  void PluginAdded(std::string plugin_info) override;
  void PluginRemoved(std::string name) override;

 private:
  std::shared_ptr<AsyncioLoop> asyncio_loop_;
};

class PyResource : public Resource, public py::trampoline_self_life_support {
 public:
  void SetLoop(std::shared_ptr<AsyncioLoop> asyncio_loop) {
    asyncio_loop_ = asyncio_loop;
  }
  std::string GetPluginInfo() override;
  void Uninitialize() override;
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) override;
  void StopStream(int64_t channel_id) override;
  PluginInitializeStatus Initialize(ResourceInterface resource_interface) override;

 private:
  std::shared_ptr<AsyncioLoop> asyncio_loop_;
};

}  // namespace psyche

#endif