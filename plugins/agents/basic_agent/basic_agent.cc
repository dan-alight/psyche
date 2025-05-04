#include "basic_agent.h"

#include <cstring>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "plugin.h"
#include "plugin_registrar.h"
#include "rapidjson/document.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace psyche {

std::string DefaultAgent::GetPluginInfo() {
  return "defacto agent";
}

PluginInitializeStatus DefaultAgent::Initialize(AgentInterface agent_interface) {
  interface_ = std::move(agent_interface);
  return PluginInitializeStatus::kSuccess;
}

void DefaultAgent::Uninitialize() {
}

void DefaultAgent::Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) {
  rapidjson::Document doc;
  doc.Parse(data.c_str());
  const char* name = doc["name"].GetString();
  if (std::strcmp(name, "chat_out") == 0) {
    receiving_channels_.push_back(channel_id);
  } else if (std::strcmp(name, "chat_in") == 0) {
    int64_t new_channel_id = interface_.get_new_channel_id();
    interface_.register_callback(new_channel_id, [this](Payload payload) {
      ReceiveChatInput(payload);
    });
    interface_.send_payload({channel_id, std::make_shared<int64_t>(new_channel_id), sizeof(int64_t), 0});
  }
}

void DefaultAgent::StopStream(int64_t channel_id) {
  for (auto it = receiving_channels_.begin(); it != receiving_channels_.end();) {
    if (channel_id == *it) {
      it = receiving_channels_.erase(it);
    } else {
      ++it;
    }
  }
}

void DefaultAgent::PluginAdded(std::string plugin_info) {
}

void DefaultAgent::PluginRemoved(std::string name) {
}

void DefaultAgent::ReceiveChatInput(Payload payload) {
  std::string& s = *std::static_pointer_cast<std::string>(payload.data);
  // do something with it
  // ...
  for (int64_t channel_id : receiving_channels_) {
    interface_.send_payload({channel_id, payload.data, payload.size, payload.offset});
  }
}

}  // namespace psyche