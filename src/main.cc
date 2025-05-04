#include "executor.h"
#include "spdlog/sinks/basic_file_sink.h"
#include "spdlog/sinks/stdout_color_sinks.h"
#include "spdlog/spdlog.h"
#include "utils.h"

int main() {
  std::string exe_dir = psyche::GetExecutableDir();
  auto log_file_path = exe_dir + "/logs/psyche.log";
  auto file_sink = std::make_shared<spdlog::sinks::basic_file_sink_mt>(log_file_path);
  auto console_sink = std::make_shared<spdlog::sinks::stdout_color_sink_mt>();
  std::vector<spdlog::sink_ptr> sinks{console_sink, file_sink};
  auto logger = std::make_shared<spdlog::logger>("", sinks.begin(), sinks.end());
  spdlog::set_default_logger(logger);

  psyche::Executor executor;
  executor.Start();
  return 0;
}