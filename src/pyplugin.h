#ifndef PSYCHE_PYPLUGIN_H_
#define PSYCHE_PYPLUGIN_H_

#include <any>
#include <iostream>
#include <shared_mutex>
#include <string>
#include <type_traits>

#include "agent.h"
#include "asyncio_loop.h"
#include "pybind11/embed.h"
#include "pybind11/pybind11.h"
#include "pybind11/stl.h"
#include "resource.h"

namespace pybind11::detail {
namespace py = pybind11;

template <>
struct type_caster<std::shared_ptr<std::any>> {
 public:
  PYBIND11_TYPE_CASTER(std::shared_ptr<std::any>, _("shared_ptr<std::any>"));

  // Convert from Python to C++
  bool load(handle src, bool) {
    if (src.is_none()) {
      value = nullptr;
      return true;
    }

    if (py::isinstance<py::str>(src)) {
      auto ptr = std::make_shared<std::any>(src.cast<std::string>());
      value = ptr;
      return true;
    }

    if (py::isinstance<py::int_>(src)) {
      auto ptr = std::make_shared<std::any>(src.cast<int64_t>());
      value = ptr;
      return true;
    }

    return false;
  }

  // Convert from C++ to Python
  static handle cast(std::shared_ptr<std::any> src, return_value_policy policy, handle parent) {
    if (src == nullptr) return none().release();
    auto* shared_copy = new std::shared_ptr<std::any>(src);
    auto deleter = [](PyObject* cap) {
      auto* ptr = static_cast<std::shared_ptr<std::any>*>(PyCapsule_GetPointer(cap, "shared_any_ptr"));
      delete ptr;
    };
    return py::capsule(shared_copy, "shared_any_ptr", deleter).release();
  }
};
}  // namespace pybind11::detail

namespace psyche {
class PyAgent : public Agent, public py::trampoline_self_life_support {
 public:
  void SetLoop(AsyncioLoop* asyncio_loop);
  void Uninitialize() override;

  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) override;
  void Invoke(
      int64_t channel_id,
      std::string data,
      std::shared_ptr<std::any> aux,
      std::shared_lock<std::shared_mutex> lock);

  void StopStream(int64_t channel_id) override;
  void Initialize(AgentInterface agent_interface) override;
  void PluginAdded(std::string plugin_info) override;
  void PluginRemoved(std::string name) override;

 private:
  AsyncioLoop* asyncio_loop_;
};
}  // namespace psyche

namespace psyche {
namespace py = pybind11;

class PyPlugin : public Plugin, public py::trampoline_self_life_support {
 public:
  void SetLoop(AsyncioLoop* asyncio_loop) {
    asyncio_loop_ = asyncio_loop;
  }
  void Uninitialize() override {
    PYBIND11_OVERRIDE_PURE(void, Plugin, uninitialize);
  }
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) override {
    PYBIND11_OVERRIDE_PURE(void, Plugin, invoke, channel_id, data, aux);
  }
  void StopStream(int64_t channel_id) override {
    PYBIND11_OVERRIDE_PURE(void, Plugin, stop_stream, channel_id);
  }

 private:
  AsyncioLoop* asyncio_loop_;
};

class PyResource : public Resource, public py::trampoline_self_life_support {
 public:
  void SetLoop(std::shared_ptr<AsyncioLoop> asyncio_loop) {
    asyncio_loop_ = asyncio_loop;
  }
  void Uninitialize() override {
    PYBIND11_OVERRIDE_PURE(void, Resource, uninitialize);
  }
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) override {
    PYBIND11_OVERRIDE_PURE(void, Resource, invoke, channel_id, data, aux);
  }
  void StopStream(int64_t channel_id) override {
    PYBIND11_OVERRIDE_PURE(void, Resource, stop_stream, channel_id);
  }
  void Initialize(ResourceInterface resource_interface) override {
    PYBIND11_OVERRIDE_PURE(void, Resource, initialize, resource_interface);
  }

 private:
  std::shared_ptr<AsyncioLoop> asyncio_loop_;
};

}  // namespace psyche

#endif