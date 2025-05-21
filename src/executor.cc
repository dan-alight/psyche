#include "executor.h"

#if defined(_WIN32)
#include <windows.h>
#else
#include <limits.h>
#include <unistd.h>
#endif

#include <chrono>
#include <filesystem>
#include <functional>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <vector>

#include "agent.h"
#include "host_interface.h"
#include "json.h"
#include "plugin.h"
#include "plugin_manager.h"
#include "pybind11/embed.h"
#include "pyplugin.h"
#include "resource.h"
#include "spdlog/spdlog.h"
#include "utils.h"
#include "uwebsockets/App.h"

namespace psyche {
namespace py = pybind11;
namespace {
constexpr std::string_view kAgentName = "psyche_agent";
}  // namespace

Executor::Executor()
    : command_handler_(data_store_),
      message_processor_(command_handler_),
      websockets_server_(message_processor_) {
  command_handler_.SetMessageProcessor(&message_processor_);
}

void Executor::Start() {
  py::scoped_interpreter guard;
  py::gil_scoped_release release;
  message_processor_.Start();
  asyncio_loop_.Start();
  StartAgent();
  {
    std::optional<PluginHolder> holder = PluginManager::Get().GetPlugin(kAgentName.data());
    if (holder) {
      std::unique_lock lock(mutex_);
      cv_.wait(lock, [&holder] {
        auto initialized = holder->initialized.lock();
        return *initialized;
      });
    }
  }
  websockets_server_.Start();

  std::string command;
  while (true) {
    std::getline(std::cin, command);
    if (command == "q" || command == "q\r") {
      break;
    } else if (command == "c") {
      std::string compute_json = ToJson({{"name", "compute"}});
      message_processor_.EnqueueMessage(InvokeCommand{-1, kAgentName.data(), compute_json, nullptr});
    } else if (command == "i") {
      std::string interrupt_json = ToJson({{"name", "interrupt"}});
      message_processor_.EnqueueMessage(InvokeCommand{-1, kAgentName.data(), interrupt_json, nullptr});
    } else if (command == "r") {
      StopAgent();
      StartAgent();
    } else {
      if (chat_send_id_ == -1) continue;
      message_processor_.EnqueueMessage(
          Payload{chat_send_id_, std::make_shared<std::any>(std::string(command))});
    }
  }

  websockets_server_.Stop();
  StopAgent();
  asyncio_loop_.Stop();
  message_processor_.Stop();
}

void Executor::StartAgent() {
  std::string exe_dir = GetExecutableDir();
  auto& plugin_manager = PluginManager::Get();
  auto plugin_dir = exe_dir + "/" + kAgentName.data();
  // plugin_manager.SetPluginsDir(plugins_dir);

  PluginLoadStatus load_status = plugin_manager.Load(plugin_dir);
  if (load_status != PluginLoadStatus::kSuccess) return;

  std::optional<PluginHolder> holder = plugin_manager.GetPlugin(kAgentName.data());
  PyPlugin* pyplugin = static_cast<PyPlugin*>((*holder).plugin);
  pyplugin->SetLoop(&asyncio_loop_);
  Agent* agent = static_cast<Agent*>((*holder).plugin);

  AgentInterface agent_interface;
  agent_interface.invoke_with_callback =
      [this](InvokeCommand command, std::function<void(Payload)> callback) -> void {
    message_processor_.RegisterCallback(command.sender_channel_id, std::move(callback));
    message_processor_.EnqueueMessage(std::move(command));
  };
  agent_interface.invoke = [this](InvokeCommand command) -> void {
    message_processor_.EnqueueMessage(std::move(command));
  };
  agent_interface.get_new_channel_id = [this]() -> int64_t {
    return message_processor_.GetNewChannelId();
  };
  agent_interface.send_payload = [this](Payload payload) -> void {
    message_processor_.EnqueueMessage(std::move(payload));
  };
  agent_interface.internal.internal_register_callback =
      [this](int64_t channel_id, std::any callback) -> void {
    auto callback_wrapper = [this, callback](Payload payload) {
      std::optional<PluginHolder> holder = PluginManager::Get().GetPlugin(kAgentName.data());
      py::gil_scoped_acquire gil;
      py::args args = py::make_tuple(py::cast(payload));
      asyncio_loop_.ScheduleFunction(
          std::move(holder->lock), std::any_cast<py::object>(callback), args);
    };
    message_processor_.RegisterPyCallback(channel_id, std::move(callback_wrapper));
  };
  agent_interface.schedule_task = [this](std::any task) -> void {
    auto callback = [this, task]() {
      py::gil_scoped_acquire gil;
      auto python_task = std::any_cast<PyFunctionWithArgs>(task);
      std::optional<PluginHolder> holder = PluginManager::Get().GetPlugin(kAgentName.data());
      if (!holder) return;
      asyncio_loop_.ScheduleFunction(
          std::move(holder->lock), python_task.func, python_task.args, python_task.kwargs);
    };
    auto t = MakeTask(callback, std::make_unique<PyTaskDeleter>());
    message_processor_.EnqueueMessage(t);
  };
  agent_interface.on_initialized = [this]() -> void {
    int64_t generic_id = message_processor_.GetNewChannelId();
    chat_send_id_ = -1;
    int64_t chat_receive_id = message_processor_.GetNewChannelId();

    message_processor_.RegisterCallback(
        chat_receive_id,
        [](Payload payload) -> void {
          auto s = std::any_cast<std::string>(*payload.data);
          spdlog::info("Chat output: {}", s);
        });
    std::string chat_out_json = ToJson({{"name", "get_chat_output"}});
    message_processor_.EnqueueMessage(InvokeCommand{chat_receive_id, kAgentName.data(), chat_out_json, nullptr});

    message_processor_.RegisterCallback(
        generic_id,
        [this](Payload payload) -> void {
          chat_send_id_ = std::any_cast<int64_t>(*payload.data);
        });
    std::string chat_in_json = ToJson({{"name", "get_chat_input_channel"}});
    message_processor_.EnqueueMessage(InvokeCommand{generic_id, kAgentName.data(), chat_in_json});

    spdlog::info("Plugin {} initialized", kAgentName);

    std::optional<PluginHolder> holder = PluginManager::Get().GetPlugin(kAgentName.data());
    *holder->initialized.lock() = true;
    cv_.notify_one();
  };
  agent->Initialize(agent_interface);
}

void Executor::StopAgent() {
  auto& plugin_manager = PluginManager::Get();
  std::optional<PluginHolder> holder = plugin_manager.GetPlugin(kAgentName.data());
  if (!holder) return;

  Plugin* plugin = holder->plugin;
  Agent* agent = static_cast<Agent*>(plugin);

  plugin_manager.DisablePluginAccess(kAgentName.data());

  holder->lock.unlock();
  std::shared_mutex* mut = holder->lock.mutex();
  // Get a lock on the plugin. This will block until all current/queued plugin calls complete
  std::unique_lock<std::shared_mutex> lock(*mut);
  lock.unlock();
  agent->Uninitialize();
  plugin_manager.Unload(kAgentName.data());

  chat_send_id_ = -1;
  spdlog::info("Plugin {} unloaded", kAgentName.data());
}

}  // namespace psyche