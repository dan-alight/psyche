#include "websockets_server.h"

#include <iostream>
#include <thread>

#include "host_interface.h"
#include "libusockets.h"
#include "rapidjson/document.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"
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
    std::vector<uWS::WebSocket<false, true, PerSocketData>*> sockets;
    for (const auto& [id, ws] : open_websockets_) {
      sockets.push_back(ws);
    }
    for (auto* ws : sockets) {
      ws->end();
    }
  });

  server_thread_.join();
}

void WebSocketsServer::StartServer() {
  uWS::App uws_app;
  loop_ = uws_app.getLoop();
  auto open = [this](auto* ws) {
    auto* user_data = ws->getUserData();
    int id = num_websocket_ids_++;
    user_data->id = id;
    open_websockets_[id] = ws;
    std::cout << "Connection opened" << std::endl;
  };
  auto message = [this](auto* ws, std::string_view message, uWS::OpCode opCode) {
    rapidjson::Document doc;
    try {
      doc.Parse(message.data(), message.size());
    } catch (const std::exception& e) {
      std::cerr << "Failed to parse message: " << e.what() << std::endl;
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
      int64_t channel_id = doc["channel_id"].GetInt64();
      std::string to = doc["to"].GetString();
      rapidjson::StringBuffer buffer;
      rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
      doc["data"].Accept(writer);
      std::string data = buffer.GetString();

      if (channel_id > -1) {
        auto* user_data = ws->getUserData();
        int ws_id = user_data->id;
        message_processor_.RegisterCallback(channel_id, [this, ws, ws_id](Payload payload) {
          constexpr size_t header_size = sizeof(char) + sizeof(int64_t) + sizeof(size_t) + sizeof(size_t) + sizeof(int32_t);
          std::vector<char> response(header_size + payload.size);
          char* data_ptr = static_cast<char*>(payload.data.get()) + payload.offset;
          response[0] = static_cast<char>(ResponseId::kPayload);
          memcpy(response.data() + sizeof(char), &payload.receiver_channel_id, sizeof(int64_t));
          memcpy(response.data() + sizeof(char) + sizeof(int64_t), &payload.size, sizeof(size_t));
          memcpy(response.data() + sizeof(char) + sizeof(int64_t) + sizeof(size_t), &payload.offset, sizeof(size_t));
          memcpy(response.data() + sizeof(char) + sizeof(int64_t) + sizeof(size_t) + sizeof(size_t), &payload.flags, sizeof(int32_t));
          memcpy(response.data() + header_size, data_ptr, payload.size);

          loop_->defer([this, ws, ws_id, msg = std::move(response)]() {
            if (open_websockets_.contains(ws_id)) {
              std::string_view msg_view(msg.data(), msg.size());
              ws->send(msg_view, uWS::OpCode::BINARY);
            }
          });
        });
      }
      message_processor_.EnqueueMessage(InvokeCommand{channel_id, to, data});
    }
  };
  auto listen = [this](us_listen_socket_t* token) {
    if (token) {
      std::cout << "WebSocket server listening on port " << kPortNum << std::endl;
      listen_socket_ = token;
    } else {
      std::cerr << "Failed to listen on port " << kPortNum << std::endl;
    }
  };
  auto close = [this](auto* ws, int /*code*/, std::string_view /*message*/) {
    auto* user_data = ws->getUserData();
    int id = user_data->id;
    open_websockets_.erase(id);
  };
  uws_app.ws<PerSocketData>(
      "/*",
      {.compression = uWS::SHARED_COMPRESSOR,
       .maxPayloadLength = 16 * 1024,
       .open = open,
       .message = message,
       .close = close});
  uws_app.listen(kPortNum, listen);
  uws_app.run();
}

void WebSocketsServer::Start() {
  server_thread_ = std::thread(&WebSocketsServer::StartServer, this);
}

}  // namespace psyche