#ifndef PSYCHE_JSON_H_
#define PSYCHE_JSON_H_

#include <iomanip>
#include <map>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "rva/variant.hpp"

namespace psyche {

using JsonValue = rva::variant<
    std::nullptr_t,
    bool,
    double,
    std::string,
    std::vector<rva::self_t>,
    std::unordered_map<std::string, rva::self_t>>;

namespace internal {
std::string SerializeJsonObject(const std::unordered_map<std::string, JsonValue>& obj);
std::string SerializeJsonValue(const JsonValue& value);

std::string EscapeJsonString(const std::string& input) {
  std::ostringstream ss;
  for (auto ch : input) {
    switch (ch) {
      case '\"':
        ss << "\\\"";
        break;
      case '\\':
        ss << "\\\\";
        break;
      case '\b':
        ss << "\\b";
        break;
      case '\f':
        ss << "\\f";
        break;
      case '\n':
        ss << "\\n";
        break;
      case '\r':
        ss << "\\r";
        break;
      case '\t':
        ss << "\\t";
        break;
      default:
        // Handle control characters and non-ASCII characters if needed
        if (ch < 32) {
          ss << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(ch);
        } else {
          ss << ch;
        }
    }
  }
  return ss.str();
}

std::string SerializeJsonValue(const JsonValue& value) {
  auto visitor = [](auto&& v) -> std::string {
    using T = std::decay_t<decltype(v)>;

    if constexpr (std::is_same_v<T, std::nullptr_t>) {
      return "null";
    } else if constexpr (std::is_same_v<T, bool>) {
      return v ? "true" : "false";
    } else if constexpr (std::is_same_v<T, double>) {
      std::ostringstream ss;
      ss << std::fixed << std::setprecision(15) << v;
      std::string result = ss.str();

      // Remove trailing zeros and decimal point if not needed
      size_t decimal_pos = result.find('.');
      if (decimal_pos != std::string::npos) {
        result.erase(result.find_last_not_of('0') + 1);
        if (result.back() == '.') {
          result.pop_back();
        }
      }

      return result;
    } else if constexpr (std::is_same_v<T, std::string>) {
      return "\"" + EscapeJsonString(v) + "\"";
    } else if constexpr (std::is_same_v<T, std::vector<JsonValue>>) {
      std::string result = "[";
      for (size_t i = 0; i < v.size(); ++i) {
        result += SerializeJsonValue(v[i]);
        if (i < v.size() - 1) {
          result += ",";
        }
      }
      result += "]";
      return result;
    } else if constexpr (std::is_same_v<T, std::unordered_map<std::string, JsonValue>>) {
      return SerializeJsonObject(v);
    }
    return "";
  };

  return rva::visit(visitor, value);
}

std::string SerializeJsonObject(const std::unordered_map<std::string, JsonValue>& obj) {
  std::string result = "{";
  size_t i = 0;

  for (const auto& [key, value] : obj) {
    result += "\"" + EscapeJsonString(key) + "\":";
    result += SerializeJsonValue(value);

    if (++i < obj.size()) {
      result += ",";
    }
  }

  result += "}";
  return result;
}

}  // namespace internal

std::string ToJson(const std::unordered_map<std::string, JsonValue>& obj) {
  return internal::SerializeJsonObject(obj);
}

}  // namespace psyche

#endif