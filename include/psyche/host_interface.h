#ifndef PSYCHE_HOST_INTERFACE_H_
#define PSYCHE_HOST_INTERFACE_H_

#include <functional>
#include <memory>
#include <string>
#include <variant>

#include "bitwise.h"

namespace psyche {

struct InvokeCommand {
  // could be -1 if no response is wanted/expected
  int64_t sender_channel_id;
  std::string to;
  std::string data;
  std::shared_ptr<void> aux = nullptr;
};

struct StopStreamCommand {
  int64_t stream_channel_id;
  std::string to;
};

template <typename T>
std::shared_ptr<void> make_shared_type_erased(T val) {
  return std::shared_ptr<void>(std::make_shared<T>(std::move(val)));
}

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
  std::shared_ptr<void> data;
  size_t size;
  size_t offset = 0;
  uint32_t flags = 0;
};

using Alert = std::string;

struct PluginInterface {
  std::function<std::string()> get_host_info;
  std::function<void(Payload)> send_payload;
  // Can be used to indicate problems
  std::function<void(Alert)> send_alert;
  // functions for network access
  // functions for registering regular (e.g every 1000ms or 5000ms, etc) callbacks
};

using ResourceInterface = PluginInterface;

struct AgentInterface : public PluginInterface {
  std::function<int64_t()> get_new_channel_id;
  std::function<void(InvokeCommand)> invoke;
  std::function<void(InvokeCommand, std::function<void(Payload)>)> invoke_with_callback;
  std::function<void(int64_t, std::function<void(Payload)>)> register_callback;
  // Can check all messages against legit streams, so no need to worry about timing on this
  // (i.e agent removes channel_id from list of legit streams and then ignores any further)
  std::function<void(StopStreamCommand)> stop_stream;
  // much more reasonable to extend the AgentInterface/PluginInterface than the class APIs
  // could have a function for engine commands
};

}  // namespace psyche

#endif  // PSYCHE_HOST_INTERFACE_H_
