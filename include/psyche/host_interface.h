#ifndef PSYCHE_HOST_INTERFACE_H_
#define PSYCHE_HOST_INTERFACE_H_

#include <any>
#include <functional>
#include <memory>
#include <string>
#include <variant>

#include "bitwise.h"
#include "pybind11/pytypes.h"

namespace psyche {
namespace py = pybind11;

struct InvokeCommand {
  int64_t sender_channel_id;
  std::string to;
  std::string data;
  std::shared_ptr<std::any> aux = nullptr;
};

struct StopStreamCommand {
  int64_t stream_channel_id;
  std::string to;
};

enum class PayloadFlags : uint32_t {
  kFinal = 1 << 0,
  kError = 1 << 1,
};
template <>
struct EnableBitwiseOperators<PayloadFlags> {
  static constexpr bool value = true;
};

struct Payload {
  int64_t receiver_channel_id;
  std::shared_ptr<std::any> data;
  uint32_t flags = 0;
};

struct PluginInterface {
  std::function<void(Payload)> send_payload;
  // functions for network access
  // functions for registering regular (e.g every 1000ms or 5000ms, etc) callbacks
};

using ResourceInterface = PluginInterface;

struct AgentInterface : public PluginInterface {
  std::function<int64_t()> get_new_channel_id;
  std::function<void(InvokeCommand)> invoke;
  std::function<void(InvokeCommand, std::function<void(Payload)>)> invoke_with_callback;
  std::function<void(int64_t, std::function<void(Payload)>)> register_callback;
  std::function<void(StopStreamCommand)> stop_stream;

  struct Internal {
    std::function<void(int64_t, py::object)> py_register_callback;
  } internal;
};

}  // namespace psyche

#endif  // PSYCHE_HOST_INTERFACE_H_
