#include "command_handler.h"

#include "host_interface.h"
#include "json.h"
#include "message_processor.h"
#include "spdlog/spdlog.h"

namespace psyche {
CommandHandler::CommandHandler(DataStore& data_store)
    : data_store_(data_store) {
  invokable_map_["add_api_key"] = [this](int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux) {
    this->AddApiKey(doc);
  };
  invokable_map_["get_resource_info"] = [this](int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux) {
    this->GetResourceInfo(channel_id);
  };
}

void CommandHandler::SetMessageProcessor(MessageProcessor* message_processor) {
  message_processor_ = message_processor;
}

void CommandHandler::Invoke(int64_t channel_id, std::string data, std::shared_ptr<std::any> aux) {
  rapidjson::Document doc;
  doc.Parse(data.c_str());
  if (doc.HasParseError()) {
    spdlog::error("Failed to parse IC data: error code {}", static_cast<int>(doc.GetParseError()));
    return;
  }
  if (!doc.IsObject()) {
    spdlog::error("IC data is not a JSON object");
    return;
  }
  if (!doc.HasMember("name") || !doc["name"].IsString()) {
    spdlog::error("IC data missing 'name' or 'name' is not a string");
    return;
  }
  const char* name = doc["name"].GetString();
  auto it = invokable_map_.find(name);
  if (it != invokable_map_.end()) {
    it->second(channel_id, doc, aux);
  } else {
    spdlog::error("CommandHandler does not have invokable {}", name);
  }
}

void CommandHandler::StopStream(int64_t channel_id) {
}

void CommandHandler::AddApiKey(rapidjson::Document& doc) {
  // Should have a more streamlined validation process
  if (!doc.HasMember("api_key") || !doc["api_key"].IsString()) {
    spdlog::error("Message missing 'api_key' or 'api_key' is not a string");
    return;
  }
  const char* api_key = doc["api_key"].GetString();
  spdlog::info("Adding API key: {}", api_key);
  sqlite3* db = data_store_.db();
  sqlite3_stmt* insert_stmt = nullptr;
  const char* insert_sql = "INSERT INTO api_key (key_value) VALUES (?)";
  sqlite3_prepare_v2(db, insert_sql, -1, &insert_stmt, nullptr);
  sqlite3_bind_text(insert_stmt, 1, api_key, -1, SQLITE_STATIC);
  sqlite3_step(insert_stmt);
  sqlite3_finalize(insert_stmt);
}

void CommandHandler::GetResourceInfo(int64_t channel_id) {
  sqlite3* db = data_store_.db();
  sqlite3_stmt* select_stmt = nullptr;
  const char* select_sql = "SELECT key_value FROM api_key";
  sqlite3_prepare_v2(db, select_sql, -1, &select_stmt, nullptr);

  std::vector<JsonValue> api_keys;
  while (sqlite3_step(select_stmt) == SQLITE_ROW) {
    const char* api_key = reinterpret_cast<const char*>(sqlite3_column_text(select_stmt, 0));
    api_keys.emplace_back(api_key);  
  }
  sqlite3_finalize(select_stmt);

  auto data = std::make_shared<std::any>(ToJson({
    {"api_keys", api_keys},
  }));

  message_processor_->EnqueueMessage(
      Payload{channel_id, data, static_cast<uint32_t>(PayloadFlags::kFinal)});
}
}  // namespace psyche