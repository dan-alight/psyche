#include "asyncio_loop.h"

#include "spdlog/spdlog.h"

namespace psyche {
namespace py = pybind11;

void AsyncioLoop::Start() {
  thread_ = std::thread(&AsyncioLoop::Run, this);
  WaitUntilReady();
}

void AsyncioLoop::Stop() {
  {
    py::gil_scoped_acquire gil;
    if (loop_.is_none()) return;
    loop_.attr("call_soon_threadsafe")(loop_.attr("stop"));
  }
  if (thread_.joinable()) {
    thread_.join();
  }
  ready_ = false;
}

bool AsyncioLoop::IsCoroutine(py::object func) {
  py::module_ inspect = py::module_::import("inspect");
  return inspect.attr("iscoroutinefunction")(func).cast<bool>();
}

void AsyncioLoop::RunSync(
    py::object func,
    std::optional<py::args> args,
    std::optional<py::kwargs> kwargs) {
  py::gil_scoped_acquire gil;
  py::args safe_args = args.has_value() ? *args : py::args();
  py::kwargs safe_kwargs = kwargs.has_value() ? *kwargs : py::kwargs();
  py::module_ asyncio = py::module_::import("asyncio");

  if (!func) {
    spdlog::error("Error in RunSync: function is not defined");
    return;
  }

  if (IsCoroutine(func)) {
    py::object future =
        asyncio.attr("run_coroutine_threadsafe")(func(*safe_args, **safe_kwargs), loop_);
    py::object exc = future.attr("exception")();
    if (!exc.is_none())
      spdlog::error("Error in RunSync: {}", py::str(exc).cast<std::string>());
  } else {
    std::mutex mutex;
    std::condition_variable cv;
    bool ready = false;

    auto wrapper = [&]() {
      try {
        py::object res = func(*safe_args, **safe_kwargs);
      } catch (const py::error_already_set& e) {
        spdlog::error("Error in RunSync: {}", e.what());
      }
      ready = true;
      cv.notify_one();
    };

    // Schedule the wrapper on the event loop
    loop_.attr("call_soon_threadsafe")(py::cpp_function(wrapper));

    // Wait for the result with the GIL released
    {
      py::gil_scoped_release release;
      std::unique_lock<std::mutex> lock(mutex);
      cv.wait(lock, [&ready] { return ready; });
    }
  }
}

void AsyncioLoop::ScheduleFunction(
    std::shared_lock<std::shared_mutex> lock,
    py::object func,
    std::optional<py::args> args,
    std::optional<py::kwargs> kwargs) {
  py::gil_scoped_acquire gil;
  py::args safe_args = args.has_value() ? *args : py::args();
  py::kwargs safe_kwargs = kwargs.has_value() ? *kwargs : py::kwargs();
  py::module_ asyncio = py::module_::import("asyncio");
  auto lock_ptr = std::make_shared<std::shared_lock<std::shared_mutex>>(std::move(lock));

  if (!func) {
    spdlog::error("Error in ScheduleFunction: function is not defined");
    return;
  }

  if (IsCoroutine(func)) {
    auto py_done_callback = py::cpp_function([lock_ptr](py::object future) {
      py::object exc = future.attr("exception")();
      if (!exc.is_none())
        spdlog::error("Error in ScheduleFunction: {}", py::str(exc).cast<std::string>());
    });

    py::object future = asyncio.attr("run_coroutine_threadsafe")(func(*safe_args, **safe_kwargs), loop_);
    future.attr("add_done_callback")(py_done_callback);
  } else {
    auto wrapper = [func, safe_args, safe_kwargs, lock_ptr]() {
      try {
        func(*safe_args, **safe_kwargs);
      } catch (const py::error_already_set& e) {
        spdlog::error("Error in ScheduleFunction: {}", e.what());
      }
    };
    loop_.attr("call_soon_threadsafe")(py::cpp_function(wrapper));
  }
}

void AsyncioLoop::Run() {
  py::gil_scoped_acquire gil;

  py::module_ asyncio = py::module_::import("asyncio");
  py::module_ selectors = py::module_::import("selectors");

  py::object selector = selectors.attr("DefaultSelector")();
  loop_ = asyncio.attr("SelectorEventLoop")(selector);
  asyncio.attr("set_event_loop")(loop_);

  ready_ = true;
  cv_.notify_one();

  try {
    loop_.attr("run_forever")();
  } catch (const py::error_already_set& e) {
    spdlog::error("Error in Python event loop: {}", e.what());
  }
  try {
    loop_.attr("run_until_complete")(loop_.attr("shutdown_asyncgens")());
    loop_.attr("close")();
    loop_ = py::none();
  } catch (const py::error_already_set& e) {
    spdlog::error("Error in Python shutdown: {}", e.what());
  }
}

void AsyncioLoop::WaitUntilReady() {
  std::unique_lock<std::mutex> lock(mutex_);
  cv_.wait(lock, [this] { return ready_; });
}

}  // namespace psyche