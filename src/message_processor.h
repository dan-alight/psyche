#ifndef PSYCHE_MESSAGE_PROCESSOR_H_
#define PSYCHE_MESSAGE_PROCESSOR_H_

#include <atomic>
#include <thread>
#include <unordered_map>
#include <variant>

#include "blockingconcurrentqueue.h"
#include "host_interface.h"

namespace psyche {

class MessageProcessor {
 public:
  void Start();
  void Stop();
  template <typename T>
  void EnqueueMessage(T&& message)
    requires(
        std::same_as<std::remove_reference_t<T>, InvokeCommand> ||
        std::same_as<std::remove_reference_t<T>, StopStreamCommand> ||
        std::same_as<std::remove_reference_t<T>, Payload> ||
        std::same_as<std::remove_reference_t<T>, Alert>)
  {
    message_queue_.enqueue(std::move(message));
  }
  int64_t GetNewChannelId();
  void RegisterCallback(int64_t channel_id, std::function<void(Payload)> callback);

 private:
  using Message = std::variant<
      InvokeCommand,
      StopStreamCommand,
      Payload,
      Alert>;

  void Run();
  void ProcessInvokeCommand(const InvokeCommand& command);
  void ProcessPayload(const Payload& payload);

  bool running_ = false;
  moodycamel::BlockingConcurrentQueue<Message> message_queue_;
  std::thread processor_thread_;
  std::atomic_int64_t num_channel_ids = 0;
  std::unordered_map<int64_t, std::function<void(Payload)>> registered_callbacks_;
};

}  // namespace psyche

#endif