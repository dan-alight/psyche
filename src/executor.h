#ifndef PSYCHE_EXECUTOR_H_
#define PSYCHE_EXECUTOR_H_

#include <string>

#include "concurrentqueue.h"
#include "host_interface.h"
#include "message_processor.h"
#include "websockets_server.h"

namespace psyche {

class Executor {
 public:
  Executor();
  void Start();

 private:
  WebSocketsServer websockets_server_;
  MessageProcessor message_processor_;
};
}  // namespace psyche

#endif