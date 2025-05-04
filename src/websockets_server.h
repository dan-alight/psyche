#ifndef PSYCHE_WEBSOCKETS_SERVER_H_
#define PSYCHE_WEBSOCKETS_SERVER_H_

#include <unordered_map>

#include "libusockets.h"
#include "message_processor.h"
#include "uwebsockets/App.h"

namespace psyche {
class WebSocketsServer {
 public:
  WebSocketsServer(MessageProcessor& mp);
  void Start();
  void Stop();

 private:
  struct PerSocketData {
    int id;
  };
  using WebSocket = uWS::WebSocket<false, true, PerSocketData>;

  void StartServer();
  void OnOpen(WebSocket* ws);
  void OnMessage(WebSocket* ws, std::string_view message, uWS::OpCode opCode);
  void OnClose(WebSocket* ws, int code, std::string_view message);
  void OnListen(us_listen_socket_t* token);

  MessageProcessor& message_processor_;
  uWS::Loop* loop_;
  us_listen_socket_t* listen_socket_ = nullptr;
  std::thread server_thread_;
  int num_websocket_ids_ = 0;
  std::unordered_map<int, WebSocket*> open_websockets_;
};
}  // namespace psyche

#endif
