#ifndef PSYCHE_UTILS_H_
#define PSYCHE_UTILS_H_
#include <string>

namespace psyche {
std::string GetExecutableDir();
std::string SnakeToPascal(const std::string& snake);
std::string ReadFile(const std::string& path);
}

#endif