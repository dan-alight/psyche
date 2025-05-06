#include "command_handler.h"

#include "host_interface.h"
#include "json.h"
#include "message_processor.h"
#include "spdlog/spdlog.h"

namespace psyche {
CommandHandler::CommandHandler(DataStore& data_store)
    : data_store_(data_store) {
  invokable_map_["add_api_key"] = [this](int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux) {
    this->AddApiKey(channel_id, doc, aux);
  };
  invokable_map_["get_resource_info"] = [this](int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux) {
    this->GetResourceInfo(channel_id, doc, aux);
  };
}

void CommandHandler::SetMessageProcessor(MessageProcessor* message_processor) {
  message_processor_ = message_processor;
}

void CommandHandler::Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) {
  rapidjson::Document doc;
  doc.Parse(data.c_str());
  if (doc.HasParseError()) {
    spdlog::warn("Failed to parse IC data: error code {}", static_cast<int>(doc.GetParseError()));
    return;
  }
  if (!doc.IsObject()) {
    spdlog::warn("IC data is not a JSON object");
    return;
  }
  if (!doc.HasMember("name") || !doc["name"].IsString()) {
    spdlog::warn("IC data missing 'name' or 'name' is not a string");
    return;
  }
  const char* name = doc["name"].GetString();
  auto it = invokable_map_.find(name);
  if (it != invokable_map_.end()) {
    it->second(channel_id, doc, aux);
  } else {
    spdlog::warn("CommandHandler does not have invokable {}", name);
  }
}
void CommandHandler::StopStream(int64_t channel_id) {
}

void CommandHandler::AddApiKey(int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux) {
  // Should have a more streamlined validation process
  if (!doc.HasMember("api_key") || !doc["api_key"].IsString()) {
    spdlog::warn("Message missing 'api_key' or 'api_key' is not a string");
    return;
  }
  const char* api_key = doc["api_key"].GetString();
  spdlog::info("Adding API key: {}", api_key);
  // ... put it in db
  // ... alert all listeners
}
void CommandHandler::GetResourceInfo(int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux) {
  std::string resource_info = ToJson({
    {"name", "resource_info"},
  });

  auto data = make_shared_type_erased(resource_info);
  message_processor_->EnqueueMessage(
      Payload{channel_id, data, 0, 0, static_cast<uint32_t>(PayloadFlags::kFinal)});
}
}  // namespace psyche