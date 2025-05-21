#ifndef PSYCHE_MESSAGE_PROCESSOR_H_
#define PSYCHE_MESSAGE_PROCESSOR_H_

#include <atomic>
#include <shared_mutex>
#include <thread>
#include <unordered_map>
#include <variant>

#include "blockingconcurrentqueue.h"
#include "command_handler.h"
#include "host_interface.h"
#include "pybind11/embed.h"

namespace psyche {
namespace py = pybind11;
struct TaskS {
  std::function<void()> func;
};

struct TaskDeleter {
  virtual void operator()(TaskS* task) const {
    delete task;
  }
  virtual ~TaskDeleter() = default;
};

struct PyTaskDeleter : TaskDeleter {
  void operator()(TaskS* task) const override {
    py::gil_scoped_acquire gil;
    delete task;
  }
};

// ——————————————————————————————
// now the wrapper owns a unique_ptr<TaskDeleter>
struct TaskDeleterWrapper {
  std::unique_ptr<TaskDeleter> deleter;

  // construct from any heap-allocated deleter:
  TaskDeleterWrapper(std::unique_ptr<TaskDeleter> d)
      : deleter(std::move(d)) {
  }

  void operator()(TaskS* task) const {
    (*deleter)(task);
  }
};

// your Task type:
using Task = std::unique_ptr<TaskS, TaskDeleterWrapper>;

// helper to make one, defaulting to the plain TaskDeleter:
inline Task MakeTask(std::function<void()> f, std::unique_ptr<TaskDeleter> del = std::make_unique<TaskDeleter>()) {
  TaskS* raw = new TaskS{std::move(f)};
  return Task{raw, TaskDeleterWrapper{std::move(del)}};
}

class MessageProcessor {
 public:
  MessageProcessor(CommandHandler& command_handler);
  void Start();
  void Stop();
  template <typename T>
  void EnqueueMessage(T&& message)
    requires(
        std::same_as<std::remove_reference_t<T>, InvokeCommand> ||
        std::same_as<std::remove_reference_t<T>, StopStreamCommand> ||
        std::same_as<std::remove_reference_t<T>, Payload> ||
        std::same_as<std::remove_reference_t<T>, Task>)
  {
    message_queue_.enqueue(std::move(message));
  }
  int64_t GetNewChannelId();
  void RegisterCallback(int64_t channel_id, std::function<void(Payload)> callback);
  void RegisterPyCallback(int64_t channel_id, std::function<void(Payload)> callback);

 private:
  struct ExitLoop {};
  using Message = std::variant<
      InvokeCommand,
      StopStreamCommand,
      Payload,
      Task,
      ExitLoop>;
  struct Callback {
    std::shared_ptr<std::function<void(Payload)>> func;
    bool is_python;
  };

  void Run();
  void ProcessInvokeCommand(const InvokeCommand& command);
  void ProcessPayload(const Payload& payload);
  void ProcessTask(const Task& task);

  CommandHandler& command_handler_;
  bool running_ = false;
  moodycamel::BlockingConcurrentQueue<Message> message_queue_;
  std::thread processor_thread_;
  std::atomic_int64_t num_channel_ids = 0;
  std::unordered_map<int64_t, Callback> registered_callbacks_;
  std::shared_mutex registered_callbacks_mutex_;
};

}  // namespace psyche

#endif