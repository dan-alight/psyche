#include <iostream>
#include <string>
#include <type_traits>

#include "agent.h"
#include "pybind11/embed.h"
#include "pybind11/pybind11.h"
#include "pybind11/stl.h"
#include "resource.h"

namespace pybind11::detail {
namespace py = pybind11;

template <>
struct type_caster<std::shared_ptr<void>> {
 public:
  PYBIND11_TYPE_CASTER(std::shared_ptr<void>, _("shared_ptr<void>"));

  // Convert from Python to C++
  bool load(handle src, bool) {
    if (src.is_none()) {
      value = nullptr;
      return true;
    }

    if (py::isinstance<py::str>(src)) {
      auto ptr = std::make_shared<std::string>(src.cast<std::string>());
      value = std::shared_ptr<void>(ptr);
      return true;
    }

    if (py::isinstance<py::int_>(src)) {
      auto ptr = std::make_shared<int64_t>(src.cast<int64_t>());
      value = std::shared_ptr<void>(ptr);
      return true;
    }

    return false;
  }

  // Convert from C++ to Python
  static handle cast(std::shared_ptr<void> src, return_value_policy policy, handle parent) {
    if (src == nullptr) return none().release();
    ;
    auto* shared_copy = new std::shared_ptr<void>(src);
    auto deleter = [](PyObject* cap) {
      auto* ptr = static_cast<std::shared_ptr<void>*>(PyCapsule_GetPointer(cap, "shared_void_ptr"));
      delete ptr;
    };
    return py::capsule(shared_copy, "shared_void_ptr", deleter).release();
  }
};
}  // namespace pybind11::detail

namespace psyche {
namespace py = pybind11;

class PyPlugin : public Plugin, public py::trampoline_self_life_support {
 public:
  std::string GetPluginInfo() override {
    PYBIND11_OVERRIDE_PURE(std::string, Plugin, get_plugin_info);
  }
  void Uninitialize() override {
    PYBIND11_OVERRIDE_PURE(void, Plugin, uninitialize);
  }
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) override {
    PYBIND11_OVERRIDE_PURE(void, Plugin, invoke, channel_id, data, aux);
  }
  void StopStream(int64_t channel_id) override {
    PYBIND11_OVERRIDE_PURE(void, Plugin, stop_stream, channel_id);
  }
};

class PyAgent : public Agent, public py::trampoline_self_life_support {
 public:
  std::string GetPluginInfo() override {
    PYBIND11_OVERRIDE_PURE(std::string, Agent, get_plugin_info);
  }

  void Uninitialize() override {
    PYBIND11_OVERRIDE_PURE(void, Agent, uninitialize);
  }

  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) override {
    PYBIND11_OVERRIDE_PURE(void, Agent, invoke, channel_id, data, aux);
  }

  void StopStream(int64_t channel_id) override {
    PYBIND11_OVERRIDE_PURE(void, Agent, stop_stream, channel_id);
  }

  PluginInitializeStatus Initialize(AgentInterface agent_interface) override {
    PYBIND11_OVERRIDE_PURE(PluginInitializeStatus, Agent, initialize, agent_interface);
  }

  void PluginAdded(std::string plugin_info) override {
    PYBIND11_OVERRIDE_PURE(void, Agent, plugin_added, plugin_info);
  }

  void PluginRemoved(std::string name) override {
    PYBIND11_OVERRIDE_PURE(void, Agent, plugin_removed, name);
  }
};

class PyResource : public Resource, public py::trampoline_self_life_support {
 public:
  std::string GetPluginInfo() override {
    PYBIND11_OVERRIDE_PURE(std::string, Resource, get_plugin_info);
  }
  void Uninitialize() override {
    PYBIND11_OVERRIDE_PURE(void, Resource, uninitialize);
  }
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) override {
    PYBIND11_OVERRIDE_PURE(void, Resource, invoke, channel_id, data, aux);
  }
  void StopStream(int64_t channel_id) override {
    PYBIND11_OVERRIDE_PURE(void, Resource, stop_stream, channel_id);
  }
  PluginInitializeStatus Initialize(ResourceInterface resource_interface) override {
    PYBIND11_OVERRIDE_PURE(PluginInitializeStatus, Resource, initialize, resource_interface);
  }
};

void CppPrint(const std::string& msg) {
  std::cout << "[Python] " << msg << std::endl;
}

template <typename T>
auto ConvertSharedVoidPtr(py::capsule cap) {
  auto* shared_void_ptr = reinterpret_cast<std::shared_ptr<void>*>(cap.get_pointer());
  if (!shared_void_ptr || !(*shared_void_ptr)) {
    if constexpr (std::is_pointer_v<T>) {
      return static_cast<T>(nullptr);
    } else {
      throw std::runtime_error("Null pointer in shared_void_ptr");  // Or return a default value
    }
  }

  if constexpr (std::is_pointer_v<T>) {
    using ValueType = typename std::remove_pointer_t<T>;
    return static_cast<T>(shared_void_ptr->get());
  } else {
    return *static_cast<T*>(shared_void_ptr->get());
  }
}

}  // namespace psyche

using psyche::Agent;
using psyche::AgentInterface;
using psyche::Alert;
using psyche::ConvertSharedVoidPtr;
using psyche::CppPrint;
using psyche::InvokeCommand;
using psyche::Payload;
using psyche::Plugin;
using psyche::PluginInitializeStatus;
using psyche::PluginInterface;
using psyche::PyAgent;
using psyche::PyPlugin;
using psyche::PyResource;
using psyche::Resource;
using psyche::StopStreamCommand;
namespace py = pybind11;

PYBIND11_EMBEDDED_MODULE(pyplugin, m) {
  py::enum_<PluginInitializeStatus>(m, "PluginInitializeStatus")
      .value("SUCCESS", PluginInitializeStatus::kSuccess)
      .value("ERROR", PluginInitializeStatus::kError)
      .export_values();

  py::class_<InvokeCommand>(m, "InvokeCommand")
      .def(py::init<>())
      .def_readwrite("sender_channel_id", &InvokeCommand::sender_channel_id)
      .def_readwrite("to", &InvokeCommand::to)
      .def_readwrite("data", &InvokeCommand::data)
      .def_readwrite("aux", &InvokeCommand::aux);

  py::class_<StopStreamCommand>(m, "StopStreamCommand")
      .def(py::init<>())
      .def_readwrite("stream_channel_id", &StopStreamCommand::stream_channel_id)
      .def_readwrite("to", &StopStreamCommand::to);

  py::class_<Payload>(m, "Payload")
      .def(py::init<>())
      .def(py::init([](int64_t receiver_channel_id, std::shared_ptr<void> data, size_t size, size_t offset) {
        return Payload{receiver_channel_id, data, size, offset};
      }))
      .def_readwrite("receiver_channel_id", &Payload::receiver_channel_id)
      .def_readwrite("data", &Payload::data)
      .def_readwrite("size", &Payload::size)
      .def_readwrite("offset", &Payload::offset);

  py::class_<PluginInterface>(m, "PluginInterface")
      .def(py::init<>())
      .def("get_host_info", [](PluginInterface& p) {
        return p.get_host_info();
      })
      .def("send_payload", [](PluginInterface& p, const Payload& payload) {
        p.send_payload(payload);
      })
      .def("send_alert", [](PluginInterface& p, const Alert& alert) {
        p.send_alert(alert);
      });

  py::class_<AgentInterface, PluginInterface>(m, "AgentInterface")
      .def(py::init<>())
      .def("get_new_channel_id", [](AgentInterface& a) {
        return a.get_new_channel_id();
      })
      .def("invoke", [](AgentInterface& a, const InvokeCommand& ic) {
        a.invoke(ic);
      })
      .def("invoke_with_callback", [](AgentInterface& a, const InvokeCommand& ic, const std::function<void(Payload)>& cb) {
        a.invoke_with_callback(ic, cb);
      })
      .def("register_callback", [](AgentInterface& a, int64_t channel_id, py::object cb) {
        auto callback = [cb](Payload payload) {
          cb.attr("__call__")(payload);
        };
        a.register_callback(channel_id, callback);
      })
      .def("stop_stream", [](AgentInterface& a, const StopStreamCommand& ssc) {
        a.stop_stream(ssc);
      });

  py::class_<Plugin, PyPlugin, py::smart_holder>(m, "Plugin")
      .def(py::init<>())
      .def("get_plugin_info", &Plugin::GetPluginInfo)
      .def("uninitialize", &Plugin::Uninitialize)
      .def("invoke", &Plugin::Invoke)
      .def("stop_stream", &Plugin::StopStream);

  py::class_<Agent, Plugin, PyAgent, py::smart_holder>(m, "Agent")
      .def(py::init<>())
      .def("initialize", &Agent::Initialize)
      .def("plugin_added", &Agent::PluginAdded)
      .def("plugin_removed", &Agent::PluginRemoved);

  py::class_<Resource, Plugin, PyResource, py::smart_holder>(m, "Resource")
      .def(py::init<>())
      .def("initialize", &Resource::Initialize);

  m.def("log", &CppPrint);
  m.def("to_int", &ConvertSharedVoidPtr<int>);
  m.def("to_string", &ConvertSharedVoidPtr<std::string>);

  py::list all_items;
  all_items.append(py::str("PluginInitializeStatus"));
  all_items.append(py::str("InvokeCommand"));
  all_items.append(py::str("StopStreamCommand"));
  all_items.append(py::str("Payload"));
  all_items.append(py::str("PluginInterface"));
  all_items.append(py::str("AgentInterface"));
  all_items.append(py::str("Plugin"));
  all_items.append(py::str("Agent"));
  all_items.append(py::str("Resource"));

  // Are these needed?
  all_items.append(py::str("log"));
  all_items.append(py::str("to_int"));
  all_items.append(py::str("to_string"));

  m.attr("__all__") = all_items;
}
