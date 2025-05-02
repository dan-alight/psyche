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
#include "spdlog/sinks/basic_file_sink.h"
#include "spdlog/sinks/stdout_color_sinks.h"
#include "spdlog/spdlog.h"
#include "utils.h"
#include "uwebsockets/App.h"

namespace psyche {
namespace py = pybind11;
namespace {
constexpr std::string_view kAgentName = "psyche_agent";
}  // namespace

Executor::Executor()
    : websockets_server_(message_processor_) {
}

void Executor::Start() {
  py::scoped_interpreter interpreter_;
  py::gil_scoped_release release;

  // Create a logger with multiple sinks
  std::string exe_dir = GetExecutableDir();
  auto log_file_path = exe_dir + "/logs/psyche.log";
  auto file_sink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(log_file_path);
  auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();
  std::vector<spdlog::sink_ptr> sinks{console_sink, file_sink};
  auto logger = std::make_shared<spdlog::logger>("", sinks.begin(), sinks.end());
  spdlog::set_default_logger(logger);

  asyncio_loop_ = std::make_shared<AsyncioLoop>();
  asyncio_loop_->Start();

  StartAgent();

  message_processor_.Start();
  std::string command;
  while (true) {
    std::getline(std::cin, command);
    if (command == "q" || command == "q\r") {
      break;
    } else if (command == "c") {
      std::string compute_json = ToJson({{"name", "compute"}});
      message_processor_.EnqueueMessage(InvokeCommand{-1, std::string(kAgentName), compute_json, nullptr});
    } else if (command == "i") {
      std::string interrupt_json = ToJson({{"name", "interrupt"}});
      message_processor_.EnqueueMessage(InvokeCommand{-1, std::string(kAgentName), interrupt_json, nullptr});
    } else if (command == "r") {
      StopAgent();
      StartAgent();
    } else {
      /* if (chat_send_id_ == -1) continue;
      auto data = make_shared_type_erased(command);
      message_processor_.EnqueueMessage(Payload{chat_send_id_, data, command.length()}); */
      std::string cout_json = ToJson({{"name", "cout"}});
      auto data = make_shared_type_erased(command);
      message_processor_.EnqueueMessage(InvokeCommand{-1, std::string(kAgentName), cout_json, data});
    }
  }
  message_processor_.Stop();
  asyncio_loop_->Stop();
}

void Executor::StartAgent() {
  std::string exe_dir = GetExecutableDir();
  auto& plugin_manager = PluginManager::Get();
  auto plugin_dir = exe_dir + "/psyche_agent";
  // plugin_manager.SetPluginsDir(plugins_dir);
  PluginLoadStatus status = plugin_manager.Load(plugin_dir);
  if (status != PluginLoadStatus::kSuccess) {
    spdlog::error("Failed to load plugin: {} with status: {}", kAgentName, static_cast<int>(status));
  }
  std::optional<PluginHolder> holder = plugin_manager.GetPlugin(std::string(kAgentName));
  PyPlugin* pyplugin = static_cast<PyPlugin*>((*holder).plugin);
  pyplugin->SetLoop(asyncio_loop_);
  Agent* agent = static_cast<Agent*>((*holder).plugin);

  AgentInterface agent_interface;
  agent_interface.get_host_info = []() -> std::string {
    return "Psyche";
  };
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
  agent_interface.internal.py_register_callback =
      [this](int64_t channel_id, py::object callback) -> void {
    auto callback_wrapper = [this, callback](Payload payload) {
      py::gil_scoped_acquire gil;

      std::optional<PluginHolder> holder = PluginManager::Get().GetPlugin(std::string(kAgentName));

      py::args args = py::make_tuple(py::cast(payload));
      asyncio_loop_->ScheduleFunction(std::move(holder->lock), callback, args);
    };
    message_processor_.RegisterCallback(channel_id, std::move(callback_wrapper));
  };
  agent->Initialize(agent_interface);
  spdlog::info("Plugin {} initialized", kAgentName);

  int64_t generic_id = message_processor_.GetNewChannelId();
  chat_send_id_ = -1;
  int64_t chat_receive_id = message_processor_.GetNewChannelId();

  message_processor_.RegisterCallback(chat_receive_id, [](Payload payload) -> void {
    std::string& s = *std::static_pointer_cast<std::string>(payload.data);
  });
  std::string chat_out_json = ToJson({{"name", "chat_out"}});
  message_processor_.EnqueueMessage(InvokeCommand{chat_receive_id, std::string(kAgentName), chat_out_json, nullptr});

  message_processor_.RegisterCallback(generic_id, [this](Payload payload) -> void {
    chat_send_id_ = *std::static_pointer_cast<int64_t>(payload.data);
  });
  std::string chat_in_json = ToJson({{"name", "chat_in"}});
  message_processor_.EnqueueMessage(InvokeCommand{generic_id, std::string(kAgentName), chat_in_json});
}

void Executor::StopAgent() {
  auto& plugin_manager = PluginManager::Get();
  std::optional<PluginHolder> holder = plugin_manager.GetPlugin(std::string(kAgentName));
  Plugin* plugin = holder->plugin;
  Agent* agent = static_cast<Agent*>(plugin);

  plugin_manager.DisablePluginAccess(std::string(kAgentName));

  holder->lock.unlock();
  std::shared_mutex* mut = holder->lock.mutex();
  // Get a lock on the plugin. This will block until all current/queued plugin calls complete
  std::unique_lock<std::shared_mutex> lock(*mut);

  agent->Uninitialize();
  plugin_manager.Unload(std::string(kAgentName));
  spdlog::info("Plugin {} unloaded", kAgentName);
}

}  // namespace psyche