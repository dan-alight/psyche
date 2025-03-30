#ifndef PSYCHE_WEBSOCKETS_SERVER_H_
#define PSYCHE_WEBSOCKETS_SERVER_H_

#include <unordered_set>

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

  void StartServer();

  MessageProcessor& message_processor_;
  uWS::Loop* loop_;
  us_listen_socket_t* listen_socket_ = nullptr;
  std::thread server_thread_;
  int num_websocket_ids_ = 0;
  std::unordered_set<int> open_websockets_;
};
}  // namespace psyche

#endif
