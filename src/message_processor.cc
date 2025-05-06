#include "message_processor.h"

#include <chrono>
#include <iostream>
#include <variant>

#include "plugin_manager.h"
#include "pybind11/embed.h"
#include "pyplugin.h"
#include "spdlog/spdlog.h"

namespace psyche {
namespace py = pybind11;
MessageProcessor::MessageProcessor(CommandHandler& command_handler)
    : command_handler_(command_handler) {
}

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
  if (command.to == "host") {
    command_handler_.Invoke(command.sender_channel_id, command.data, command.aux);
    return;
  }

  std::optional<PluginHolder> holder = PluginManager::Get().GetPlugin(command.to);
  if (!holder.has_value()) {
    spdlog::warn("Could not process InvokeCommand. Plugin {} not available", command.to);
    return;
  }

  if (holder->type == PluginType::kAgent) {
    if (holder->language == PluginLanguage::kPython) {
      auto* plugin = static_cast<PyAgent*>(holder->plugin);
      plugin->Invoke(command.sender_channel_id, command.data, command.aux, std::move(holder->lock));
    }
  }
}

void MessageProcessor::ProcessPayload(const Payload& payload) {
  std::shared_ptr<std::function<void(Payload)>> func;
  bool is_python = false;

  {
    std::shared_lock lock(registered_callbacks_mutex_);

    auto search = registered_callbacks_.find(payload.receiver_channel_id);
    if (search == registered_callbacks_.end()) {
      return;
    }

    func = search->second.func;
    is_python = search->second.is_python;
  }

  if (payload.flags & PayloadFlags::kFinal) {
    std::unique_lock unique_lock(registered_callbacks_mutex_);
    registered_callbacks_.erase(payload.receiver_channel_id);
  }

  if (!is_python) {
    (*func)(payload);
    return;
  }

  py::gil_scoped_acquire gil;
  {
    auto func_local = std::move(func);
    (*func_local)(payload);
  }
}

int64_t MessageProcessor::GetNewChannelId() {
  return num_channel_ids++;
}

void MessageProcessor::RegisterCallback(int64_t channel_id, std::function<void(Payload)> callback) {
  std::unique_lock lock(registered_callbacks_mutex_);
  registered_callbacks_[channel_id] =
      Callback{std::make_shared<std::function<void(Payload)>>(callback), false};
}

void MessageProcessor::RegisterPyCallback(int64_t channel_id, std::function<void(Payload)> callback) {
  std::unique_lock lock(registered_callbacks_mutex_);
  registered_callbacks_[channel_id] =
      Callback{std::make_shared<std::function<void(Payload)>>(callback), true};
}
}  // namespace psyche