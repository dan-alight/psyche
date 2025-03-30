#include "utils.h"

#if defined(_WIN32)
#include <windows.h>
#else
#include <limits.h>
#include <unistd.h>
#endif

#include <chrono>
#include <filesystem>
#include <functional>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <vector>

namespace psyche {
std::string GetExecutableDir() {
  std::string exe_path;

#if defined(_WIN32)
  char path[MAX_PATH];
  GetModuleFileName(nullptr, path, MAX_PATH);
  exe_path = path;
#else
  char path[PATH_MAX];
  ssize_t count = readlink("/proc/self/exe", path, PATH_MAX);
  if (count != -1) {
    path[count] = '\0';
    exe_path = path;
  }
#endif

  std::filesystem::path fs_path(exe_path);
  return fs_path.parent_path().string();
}

std::string SnakeToPascal(const std::string& snake) {
  std::string pascal_case;
  bool capitalize = true;

  for (char c : snake) {
    if (c == '_') {
      capitalize = true;
    } else {
      pascal_case += capitalize ? std::toupper(c) : c;
      capitalize = false;
    }
  }

  return pascal_case;
}
}  // namespace psyche