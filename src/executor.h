#ifndef PSYCHE_EXECUTOR_H_
#define PSYCHE_EXECUTOR_H_

#include <memory>
#include <string>

#include "asyncio_loop.h"
#include "command_handler.h"
#include "concurrentqueue.h"
#include "data_store.h"
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

  AsyncioLoop asyncio_loop_;
  DataStore data_store_;
  CommandHandler command_handler_;
  WebSocketsServer websockets_server_;
  MessageProcessor message_processor_;

  int64_t chat_send_id_ = -1;
};
}  // namespace psyche

#endif