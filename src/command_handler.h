#ifndef PSYCHE_COMMAND_HANDLER_H_
#define PSYCHE_COMMAND_HANDLER_H_

#include <memory>
#include <string>
#include <unordered_map>
#include <functional>

#include "data_store.h"
#include "rapidjson/document.h"

namespace psyche {
class CommandHandler {
 public:
  CommandHandler(DataStore& data_store);
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux);
  void StopStream(int64_t channel_id);

 private:
  DataStore& data_store_;
  std::unordered_map<
      std::string,
      std::function<void(int64_t, rapidjson::Document&, std::shared_ptr<void>)>>
      invokable_map_;
};
}  // namespace psyche

#endif