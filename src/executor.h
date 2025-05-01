#ifndef PSYCHE_EXECUTOR_H_
#define PSYCHE_EXECUTOR_H_

#include <memory>
#include <string>

#include "asyncio_loop.h"
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
  void StartAgent();
  void StopAgent();

  WebSocketsServer websockets_server_;
  MessageProcessor message_processor_;
  std::shared_ptr<AsyncioLoop> asyncio_loop_;

  int64_t chat_send_id_ = -1;
};
}  // namespace psyche

#endif