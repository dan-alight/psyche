#ifndef PSYCHE_EXECUTOR_H_
#define PSYCHE_EXECUTOR_H_

#include <string>
#include <memory>

#include "concurrentqueue.h"
#include "host_interface.h"
#include "message_processor.h"
#include "websockets_server.h"
#include "asyncio_loop.h"

namespace psyche {

class Executor {
 public:
  Executor();
  void Start();

 private:
  WebSocketsServer websockets_server_;
  MessageProcessor message_processor_;
  std::shared_ptr<AsyncioLoop> asyncio_loop_;
};
}  // namespace psyche

#endif