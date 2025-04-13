#include "message_processor.h"

#include <chrono>
#include <iostream>
#include <variant>

#include "plugin_manager.h"
#include "pybind11/embed.h"

namespace psyche {
namespace py = pybind11;
void MessageProcessor::Start() {
  processor_thread_ = std::thread(&MessageProcessor::Run, this);
}
void MessageProcessor::Stop() {
  message_queue_.enqueue(ExitLoop{});
  processor_thread_.join();
  // Callbacks might own Python objects.
  // Must clear them before Python interpreter shuts down.
  py::gil_scoped_acquire gil;
  registered_callbacks_.clear();
}
void MessageProcessor::Run() {
  running_ = true;
  py::gil_scoped_acquire gil;
  Message message;
  auto visitor = [this](auto&& arg) {
    using T = std::decay_t<decltype(arg)>;
    if constexpr (std::is_same_v<T, InvokeCommand>) {
      ProcessInvokeCommand(arg);
    } else if constexpr (std::is_same_v<T, StopStreamCommand>) {
    } else if constexpr (std::is_same_v<T, Payload>) {
      ProcessPayload(arg);
    } else if constexpr (std::is_same_v<T, Alert>) {
    } else if constexpr (std::is_same_v<T, ExitLoop>) {
      running_ = false;
    }
  };
  while (running_) {
    message_queue_.wait_dequeue(message);
    std::visit(visitor, message);
  }
}

void MessageProcessor::ProcessInvokeCommand(const InvokeCommand& command) {
  Plugin* plugin = PluginManager::Get().GetPlugin(command.to);
  plugin->Invoke(command.sender_channel_id, command.data, command.aux);
}

void MessageProcessor::ProcessPayload(const Payload& payload) {
  auto search = registered_callbacks_.find(payload.receiver_channel_id);
  if (search == registered_callbacks_.end()) return;
  if (payload.flags & PayloadFlags::kFinal) {
    auto cb = search->second;
    registered_callbacks_.erase(payload.receiver_channel_id);
    cb(payload);
  } else {
    auto& cb = search->second;
    cb(payload);
  }
}

int64_t MessageProcessor::GetNewChannelId() {
  return num_channel_ids++;
}

void MessageProcessor::RegisterCallback(int64_t channel_id, std::function<void(Payload)> callback) {
  registered_callbacks_[channel_id] = callback;
}

void MessageProcessor::RemoveCallback(int64_t channel_id) {
  registered_callbacks_.erase(channel_id);
}

}  // namespace psyche