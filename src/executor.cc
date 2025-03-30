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
#include "resource.h"
#include "spdlog/sinks/basic_file_sink.h"
#include "spdlog/sinks/stdout_color_sinks.h"
#include "spdlog/spdlog.h"
#include "utils.h"
#include "uwebsockets/App.h"

namespace psyche {
namespace py = pybind11;

Executor::Executor()
    : websockets_server_(message_processor_) {
}

void Executor::Start() {
  py::scoped_interpreter interpreter_;

  std::string exe_dir = GetExecutableDir();

  // Create a logger with multiple sinks
  auto log_file_path = exe_dir + "/logs/psyche.log";
  auto file_sink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(log_file_path);
  auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();
  std::vector<spdlog::sink_ptr> sinks{console_sink, file_sink};
  auto logger = std::make_shared<spdlog::logger>("", sinks.begin(), sinks.end());
  spdlog::set_default_logger(logger);

  auto& plugin_manager = PluginManager::Get();
  auto plugins_dir = exe_dir + "/plugins";
  plugin_manager.SetPluginsDir(plugins_dir);
  auto plugin_name = "python_agent";
  PluginLoadStatus status = plugin_manager.Load(plugin_name, PluginType::kAgent);
  if (status != PluginLoadStatus::kSuccess) {
    spdlog::error("Failed to load plugin: {} with status: {}", plugin_name, static_cast<int>(status));
  }
  Agent* plugin = static_cast<Agent*>(plugin_manager.GetPlugin(plugin_name));

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
  agent_interface.register_callback =
      [this](int64_t channel_id, std::function<void(Payload)> callback) -> void {
    message_processor_.RegisterCallback(channel_id, std::move(callback));
  };
  agent_interface.send_payload = [this](Payload payload) -> void {
    message_processor_.EnqueueMessage(std::move(payload));
  };

  plugin->Initialize(agent_interface);

  int64_t generic_id = message_processor_.GetNewChannelId();
  int64_t chat_send_id = -1;
  int64_t chat_receive_id = message_processor_.GetNewChannelId();

  message_processor_.RegisterCallback(chat_receive_id, [](Payload payload) -> void {
    std::string& s = *std::static_pointer_cast<std::string>(payload.data);
  });
  std::string chat_out_json = ToJson({{"name", "chat_out"}});
  message_processor_.EnqueueMessage(InvokeCommand{chat_receive_id, "python_agent", chat_out_json, nullptr});

  message_processor_.RegisterCallback(generic_id, [&chat_send_id](Payload payload) -> void {
    chat_send_id = *std::static_pointer_cast<int64_t>(payload.data);
  });

  std::string chat_in_json = ToJson({{"name", "chat_in"}});
  message_processor_.EnqueueMessage(InvokeCommand{generic_id, "python_agent", chat_in_json});

  py::gil_scoped_release release;
  message_processor_.Start();
  std::string command;
  while (true) {
    std::getline(std::cin, command);
    if (command == "q" || command == "q\r") {
      break;
    } else {
      if (chat_send_id == -1) continue;
      auto data = make_shared_type_erased(command);
      message_processor_.EnqueueMessage(Payload{chat_send_id, data, command.length(), 0});
    }
  }
  message_processor_.Stop();
}

}  // namespace psyche