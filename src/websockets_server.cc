#include "websockets_server.h"

#include <iostream>
#include <thread>
#include <cstring>

#include "host_interface.h"
#include "libusockets.h"
#include "rapidjson/document.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"
#include "spdlog/spdlog.h"
#include "uwebsockets/App.h"
#include "uwebsockets/Loop.h"

namespace psyche {
namespace {
constexpr int kPortNum = 5010;

enum class ResponseId : char {
  kNewChannelId = 0,
  kPayload,
};
}  // namespace

WebSocketsServer::WebSocketsServer(MessageProcessor& mp)
    : message_processor_(mp) {
}

void WebSocketsServer::Stop() {
  if (!server_thread_.joinable()) return;
  while (listen_socket_ == nullptr) continue;  // TODO: deal with case where listening fails

  loop_->defer([this]() {
    us_listen_socket_close(0, listen_socket_);
    std::vector<WebSocket*> sockets;
    for (const auto& [id, ws] : open_websockets_) {
      sockets.push_back(ws);
    }
    for (auto* ws : sockets) {
      ws->end();
    }
  });

  server_thread_.join();
}

void WebSocketsServer::OnOpen(WebSocket* ws) {
  PerSocketData* user_data = ws->getUserData();
  int id = num_websocket_ids_++;
  user_data->id = id;
  open_websockets_[id] = ws;
  spdlog::info("WebSocket opened with id: {}", id);
}

void WebSocketsServer::OnMessage(WebSocket* ws, std::string_view message, uWS::OpCode opCode) {
  rapidjson::Document doc;
  doc.Parse(message.data(), message.size());
  if (doc.HasParseError()) {
    spdlog::warn("Failed to parse message: error code {}", static_cast<int>(doc.GetParseError()));
    return;
  }

  if (!doc.IsObject()) {
    spdlog::warn("Message is not a JSON object");
    return;
  }

  if (!doc.HasMember("type") || !doc["type"].IsString()) {
    spdlog::warn("Message missing 'type' field or 'type' is not a string");
    return;
  }

  std::string msg_type = doc["type"].GetString();
  if (msg_type == "get_new_channel_id") {
    constexpr size_t header_size = sizeof(char);
    int64_t new_channel_id = message_processor_.GetNewChannelId();
    std::vector<char> response(header_size + sizeof(int64_t));
    response[0] = static_cast<char>(ResponseId::kNewChannelId);
    memcpy(response.data() + header_size, &new_channel_id, sizeof(int64_t));
    ws->send(std::string_view(response.data(), response.size()), uWS::OpCode::BINARY);

  } else if (msg_type == "invoke") {
    if (!doc.HasMember("channel_id") || !doc["channel_id"].IsInt64()) {
      spdlog::warn("Message missing 'channel_id' or 'channel_id' is not an int64");
      return;
    }
    int64_t channel_id = doc["channel_id"].GetInt64();

    if (!doc.HasMember("to") || !doc["to"].IsString()) {
      spdlog::warn("Message missing 'to' or 'to' is not a string");
      return;
    }
    const char* to = doc["to"].GetString();

    if (!doc.HasMember("data") || !doc["data"].IsObject()) {
      spdlog::warn("Message missing 'data' or 'data' is not an object");
      return;
    }
    rapidjson::StringBuffer buffer;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
    doc["data"].Accept(writer);
    std::string data = buffer.GetString();

    if (channel_id == -1) {
      message_processor_.EnqueueMessage(InvokeCommand{channel_id, to, data});
      return;
    }

    auto* user_data = ws->getUserData();
    int ws_id = user_data->id;
    message_processor_.RegisterCallback(channel_id, [this, ws, ws_id](Payload payload) {
      constexpr size_t header_size = sizeof(char) + sizeof(int64_t) + sizeof(uint32_t);
      
      // Right now we're just assuming the data is a null-terminated char array.
      // Later we can support something like struct S { char* data; size_t size; size_t offset; };
      char* data_ptr = std::any_cast<char>(payload.data.get());
      size_t payload_size = std::strlen(data_ptr);
      std::vector<char> response(header_size + payload_size);
      response[0] = static_cast<char>(ResponseId::kPayload);
      memcpy(response.data() + sizeof(char), &payload.receiver_channel_id, sizeof(int64_t));
      memcpy(response.data() + sizeof(char) + sizeof(int64_t), &payload.flags, sizeof(uint32_t));
      memcpy(response.data() + header_size, data_ptr, payload_size);

      loop_->defer([this, ws, ws_id, msg = std::move(response)]() {
        if (!open_websockets_.contains(ws_id)) return;
        std::string_view msg_view(msg.data(), msg.size());
        ws->send(msg_view, uWS::OpCode::BINARY);
      });
    });
    message_processor_.EnqueueMessage(InvokeCommand{channel_id, to, data});
  }
}

void WebSocketsServer::OnListen(us_listen_socket_t* token) {
  if (token) {
    spdlog::info("Listening on port {}", kPortNum);
    listen_socket_ = token;
  } else {
    spdlog::error("Failed to listen on port {}", kPortNum);
  }
}

void WebSocketsServer::OnClose(WebSocket* ws, int /*code*/, std::string_view /*message*/) {
  PerSocketData* user_data = ws->getUserData();
  int id = user_data->id;
  open_websockets_.erase(id);
  spdlog::info("WebSocket closed with id: {}", id);
}

void WebSocketsServer::StartServer() {
  uWS::App uws_app;
  loop_ = uws_app.getLoop();

  uws_app.ws<PerSocketData>(
      "/*",
      {.compression = uWS::SHARED_COMPRESSOR,
       .maxPayloadLength = 16 * 1024,
       .open = [this](auto* ws) { OnOpen(ws); },
       .message = [this](auto* ws, std::string_view msg, uWS::OpCode op) { OnMessage(ws, msg, op); },
       .close = [this](auto* ws, int code, std::string_view msg) { OnClose(ws, code, msg); }});

  uws_app.listen(kPortNum, [this](us_listen_socket_t* token) { OnListen(token); });
  uws_app.run();
}

void WebSocketsServer::Start() {
  server_thread_ = std::thread(&WebSocketsServer::StartServer, this);
}

}  // namespace psyche