#ifndef PSYCHE_ASYNCIO_LOOP_H_
#define PSYCHE_ASYNCIO_LOOP_H_

#include <condition_variable>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <thread>

#include "pybind11/embed.h"

namespace psyche {
namespace py = pybind11;
class AsyncioLoop {
 public:
  void Start();
  void Stop();
  void RunSync(
      py::object func,
      std::optional<py::args> args = std::nullopt,
      std::optional<py::kwargs> kwargs = std::nullopt);
  void ScheduleFunction(
      std::shared_lock<std::shared_mutex> lock,
      py::object func,
      std::optional<py::args> args = std::nullopt,
      std::optional<py::kwargs> kwargs = std::nullopt);

 private:
  bool IsCoroutine(py::object func);
  void Run();
  void WaitUntilReady();

  py::object loop_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  bool ready_ = false;
};
}  // namespace psyche

#endif