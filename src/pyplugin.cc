#include "pyplugin.h"

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
#include "spdlog/spdlog.h"

namespace psyche {

void PyAgent::SetLoop(AsyncioLoop* asyncio_loop) {
  asyncio_loop_ = asyncio_loop;
}

void PyAgent::Uninitialize() {
  py::gil_scoped_acquire gil;
  py::function override = py::get_override(this, "uninitialize");
  asyncio_loop_->RunSync(override);
}

void PyAgent::Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) {
}

void PyAgent::Invoke(
    int64_t channel_id,
    std::string data,
    std::shared_ptr<std::any> aux,
    std::shared_lock<std::shared_mutex> lock) {
  py::gil_scoped_acquire gil;
  py::function override = py::get_override(this, "invoke");
  asyncio_loop_->ScheduleFunction(std::move(lock), override, py::make_tuple(channel_id, data, aux));
}

void PyAgent::StopStream(int64_t channel_id) {
  py::gil_scoped_acquire gil;
  py::function override = py::get_override(this, "stop_stream");
  /* asyncio_loop_->ScheduleFunction(override, py::make_tuple(channel_id)); */
}

void PyAgent::Initialize(AgentInterface agent_interface) {
  py::gil_scoped_acquire gil;
  py::function override = py::get_override(this, "initialize");
  asyncio_loop_->RunSync(override, py::make_tuple(agent_interface));
}

void PyAgent::PluginAdded(std::string plugin_info) {
  PYBIND11_OVERRIDE_PURE(void, Agent, plugin_added, plugin_info);
}

void PyAgent::PluginRemoved(std::string name) {
  PYBIND11_OVERRIDE_PURE(void, Agent, plugin_removed, name);
}

void CppPrint(const std::string& msg) {
  std::cout << "[Python] " << msg << std::endl;
}

template <typename T>
T ConvertSharedAnyPtr(py::capsule cap) {
  auto* shared_any_ptr = reinterpret_cast<std::shared_ptr<std::any>*>(cap.get_pointer());
  if (!shared_any_ptr || !(*shared_any_ptr)) {
    if constexpr (std::is_pointer_v<T>) {
      return static_cast<T>(nullptr);
    }
    throw std::runtime_error("Invalid or empty std::any pointer");
  }

  try {
    if constexpr (std::is_pointer_v<T>) {
      // For pointer types, this needs special handling
      // This assumes the std::any contains a pointer of type T
      auto& any_ref = **shared_any_ptr;
      if (any_ref.type() == typeid(T)) {
        return std::any_cast<T>(any_ref);
      } else {
        throw std::runtime_error("Type mismatch in std::any");
      }
    } else {
      // For value types, we can directly try to cast
      return std::any_cast<T>(**shared_any_ptr);
    }
  } catch (const std::bad_any_cast& e) {
    throw std::runtime_error(std::string("Type conversion error: ") + e.what());
  }
}

}  // namespace psyche

using psyche::Agent;
using psyche::AgentInterface;
using psyche::AsyncioLoop;
using psyche::ConvertSharedAnyPtr;
using psyche::CppPrint;
using psyche::InvokeCommand;
using psyche::Payload;
using psyche::PayloadFlags;
using psyche::Plugin;
using psyche::PluginInterface;
using psyche::PyAgent;
using psyche::PyPlugin;
using psyche::PyResource;
using psyche::Resource;
using psyche::StopStreamCommand;
namespace py = pybind11;

PYBIND11_EMBEDDED_MODULE(pyplugin, m) {
  py::class_<InvokeCommand>(m, "InvokeCommand")
      .def(py::init<>())
      .def(
          py::init([](int64_t sender_channel_id, std::string to, std::string data, std::shared_ptr<std::any> aux) {
            return InvokeCommand{sender_channel_id, to, data, aux};
          }),
          py::arg("sender_channel_id") = -1,
          py::arg("to") = "",
          py::arg("data") = "",
          py::arg("aux") = nullptr)
      .def_readwrite("sender_channel_id", &InvokeCommand::sender_channel_id)
      .def_readwrite("to", &InvokeCommand::to)
      .def_readwrite("data", &InvokeCommand::data)
      .def_readwrite("aux", &InvokeCommand::aux);

  py::class_<StopStreamCommand>(m, "StopStreamCommand")
      .def(py::init<>())
      .def_readwrite("stream_channel_id", &StopStreamCommand::stream_channel_id)
      .def_readwrite("to", &StopStreamCommand::to);

  py::enum_<PayloadFlags>(m, "PayloadFlags")
      .value("FINAL", PayloadFlags::kFinal)
      .value("ERROR", PayloadFlags::kError)
      .def("__int__", [](PayloadFlags flag) {
        return static_cast<uint32_t>(flag);
      })
      .def("__or__", [](PayloadFlags self, const py::object& other) -> py::object {
        uint32_t self_val = static_cast<uint32_t>(self);
        if (py::isinstance<PayloadFlags>(other)) {
          uint32_t other_val = static_cast<uint32_t>(other.cast<PayloadFlags>());
          return py::int_(self_val | other_val);
        } else if (py::isinstance<py::int_>(other)) {
          uint32_t other_val = other.cast<uint32_t>();
          return py::int_(self_val | other_val);
        }
        return py::cast(Py_NotImplemented);
      })
      .def("__ror__", [](PayloadFlags self, const py::object& other) -> py::object {
        if (py::isinstance<py::int_>(other)) {
          uint32_t other_val = other.cast<uint32_t>();
          return py::int_(other_val | static_cast<uint32_t>(self));
        }
        return py::cast(Py_NotImplemented);
      })
      .def("__and__", [](PayloadFlags self, const py::object& other) -> py::object {
        uint32_t self_val = static_cast<uint32_t>(self);
        if (py::isinstance<PayloadFlags>(other)) {
          uint32_t other_val = static_cast<uint32_t>(other.cast<PayloadFlags>());
          return py::int_(self_val & other_val);
        } else if (py::isinstance<py::int_>(other)) {
          uint32_t other_val = other.cast<uint32_t>();
          return py::int_(self_val & other_val);
        }
        return py::cast(Py_NotImplemented);
      })
      .def("__rand__", [](PayloadFlags self, const py::object& other) -> py::object {
        if (py::isinstance<py::int_>(other)) {
          uint32_t other_val = other.cast<uint32_t>();
          return py::int_(other_val & static_cast<uint32_t>(self));
        }
        return py::cast(Py_NotImplemented);
      })
      .def("__xor__", [](PayloadFlags self, const py::object& other) -> py::object {
        uint32_t self_val = static_cast<uint32_t>(self);
        if (py::isinstance<PayloadFlags>(other)) {
          uint32_t other_val = static_cast<uint32_t>(other.cast<PayloadFlags>());
          return py::int_(self_val ^ other_val);
        } else if (py::isinstance<py::int_>(other)) {
          uint32_t other_val = other.cast<uint32_t>();
          return py::int_(self_val ^ other_val);
        }
        return py::cast(Py_NotImplemented);
      })
      .def("__rxor__", [](PayloadFlags self, const py::object& other) -> py::object {
        if (py::isinstance<py::int_>(other)) {
          uint32_t other_val = other.cast<uint32_t>();
          return py::int_(other_val ^ static_cast<uint32_t>(self));
        }
        return py::cast(Py_NotImplemented);
      })
      .def("__invert__", [](PayloadFlags self) -> uint32_t {
        return ~static_cast<uint32_t>(self);
      });

  py::class_<Payload>(m, "Payload")
      .def(py::init<>())
      .def(
          py::init([](int64_t receiver_channel_id, std::shared_ptr<std::any> data, uint32_t flags) {
            return Payload{receiver_channel_id, data, flags};
          }),
          py::arg("receiver_channel_id") = -1,
          py::arg("data") = nullptr,
          py::arg("flags") = 0)
      .def_readwrite("receiver_channel_id", &Payload::receiver_channel_id)
      .def_readwrite("data", &Payload::data)
      .def_readwrite("flags", &Payload::flags);

  py::class_<PluginInterface>(m, "PluginInterface")
      .def(py::init<>())
      .def("send_payload", [](PluginInterface& p, const Payload& payload) {
        p.send_payload(payload);
      });

  py::class_<AgentInterface, PluginInterface>(m, "AgentInterface")
      .def(py::init<>())
      .def("get_new_channel_id", [](AgentInterface& a) {
        return a.get_new_channel_id();
      })
      .def("invoke", [](AgentInterface& a, const InvokeCommand& ic) {
        a.invoke(ic);
      })
      .def("invoke_with_callback", [](AgentInterface& a, const InvokeCommand& ic, py::object cb) {
        a.internal.internal_register_callback(ic.sender_channel_id, cb);
        a.invoke(ic);
      })
      .def("register_callback", [](AgentInterface& a, int64_t channel_id, py::object cb) {
        a.internal.internal_register_callback(channel_id, cb);
      })
      .def("stop_stream", [](AgentInterface& a, const StopStreamCommand& ssc) {
        a.stop_stream(ssc);
      });

  py::class_<Plugin, PyPlugin, py::smart_holder>(m, "Plugin")
      .def(py::init<>());

  py::class_<Agent, Plugin, PyAgent, py::smart_holder>(m, "Agent")
      .def(py::init<>());

  py::class_<Resource, Plugin, PyResource, py::smart_holder>(m, "Resource")
      .def(py::init<>());

  m.def("log", &CppPrint);
  m.def("to_int", &ConvertSharedAnyPtr<int>);
  m.def("to_string", &ConvertSharedAnyPtr<std::string>);

  py::list all_items;
  all_items.append(py::str("PluginInitializeStatus"));
  all_items.append(py::str("InvokeCommand"));
  all_items.append(py::str("StopStreamCommand"));
  all_items.append(py::str("PayloadFlags"));
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