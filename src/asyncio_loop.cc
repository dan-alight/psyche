#include "asyncio_loop.h"

namespace psyche {
namespace py = pybind11;

AsyncioLoop::AsyncioLoop() {
  py::gil_scoped_acquire gil;
  loop_ = py::none();
}

void AsyncioLoop::Start() {
  thread_ = std::thread(&AsyncioLoop::Run, this);
  WaitUntilReady();
}

void AsyncioLoop::Stop() {
  py::gil_scoped_acquire gil;
  if (loop_.is_none()) return;
  loop_.attr("call_soon_threadsafe")(loop_.attr("stop"));
  py::gil_scoped_release release;
  if (thread_.joinable()) {
    thread_.join();
  }
}

bool AsyncioLoop::IsCoroutine(py::object func) {
  py::module_ inspect = py::module_::import("inspect");
  return inspect.attr("iscoroutinefunction")(func).cast<bool>();
}

py::object AsyncioLoop::RunSync(
    py::object func,
    std::optional<py::args> args,
    std::optional<py::kwargs> kwargs) {
  py::gil_scoped_acquire gil;
  py::args safe_args = args.has_value() ? *args : py::args();
  py::kwargs safe_kwargs = kwargs.has_value() ? *kwargs : py::kwargs();
  py::module_ asyncio = py::module_::import("asyncio");
  if (IsCoroutine(func)) {
    py::object future =
        asyncio.attr("run_coroutine_threadsafe")(func(*safe_args, **safe_kwargs), loop_);
    py::object result = future.attr("result")();
    return result;
  } else {
    // Use C++ synchronization primitives
    std::mutex mutex;
    std::condition_variable cv;
    bool ready = false;
    py::object result_value;

    // Create a wrapper function that will execute the Python code and notify when done
    auto wrapper = [&]() {
      // Execute the Python function (with GIL already held by the event loop)
      py::object res = func(*safe_args, **safe_kwargs);
      result_value = res;
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

    return result_value;
  }
}

void AsyncioLoop::ScheduleFunction(
    std::shared_lock<std::shared_mutex>&& lock,
    py::object func,
    std::optional<py::args> args,
    std::optional<py::kwargs> kwargs) {
  py::gil_scoped_acquire gil;
  py::args safe_args = args.has_value() ? *args : py::args();
  py::kwargs safe_kwargs = kwargs.has_value() ? *kwargs : py::kwargs();
  py::module_ asyncio = py::module_::import("asyncio");
  auto lock_ptr = std::make_shared<std::shared_lock<std::shared_mutex>>(std::move(lock));
  if (IsCoroutine(func)) {
    py::object future = asyncio.attr("run_coroutine_threadsafe")(func(*safe_args, **safe_kwargs), loop_);
    auto py_done_callback = py::cpp_function([lock_ptr](py::object) {
      int i = 0;
    });
    future.attr("add_done_callback")(py_done_callback);
  } else {
    auto wrapper = [func, safe_args, safe_kwargs, lock_ptr]() {
      func(*safe_args, **safe_kwargs);
    };
    loop_.attr("call_soon_threadsafe")(py::cpp_function(wrapper));
  }
}

void AsyncioLoop::Run() {
  py::gil_scoped_acquire gil;
  try {
    py::module_ asyncio = py::module_::import("asyncio");
    py::module_ selectors = py::module_::import("selectors");

    py::object selector = selectors.attr("DefaultSelector")();
    loop_ = asyncio.attr("SelectorEventLoop")(selector);
    asyncio.attr("set_event_loop")(loop_);

    ready_ = true;
    cv_.notify_one();

    loop_.attr("run_forever")();

    try {
      loop_.attr("run_until_complete")(loop_.attr("shutdown_asyncgens")());
      loop_.attr("close")();
    } catch (const py::error_already_set& e) {
      std::cerr << "Python error in shutdown: " << e.what() << std::endl;
    }

  } catch (const py::error_already_set& e) {
    std::cerr << "Python error in event loop: " << e.what() << std::endl;
  }
}

void AsyncioLoop::WaitUntilReady() {
  std::unique_lock<std::mutex> lock(mutex_);
  cv_.wait(lock, [this] { return ready_; });
}

}  // namespace psyche