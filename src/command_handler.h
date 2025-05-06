#ifndef PSYCHE_COMMAND_HANDLER_H_
#define PSYCHE_COMMAND_HANDLER_H_

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

#include "data_store.h"
#include "rapidjson/document.h"

namespace psyche {
class MessageProcessor;

enum class StateUpdate {
  kAddApiKey,
};

class CommandHandler {
 public:
  CommandHandler(DataStore& data_store);
  void SetMessageProcessor(MessageProcessor* message_processor);
  void Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux);
  void StopStream(int64_t channel_id);

 private:
  void AddApiKey(int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux);
  void GetResourceInfo(int64_t channel_id, rapidjson::Document& doc, std::shared_ptr<void> aux);

  DataStore& data_store_;
  MessageProcessor* message_processor_;
  std::unordered_map<
      std::string,
      std::function<void(int64_t, rapidjson::Document&, std::shared_ptr<void>)>>
      invokable_map_;
};
}  // namespace psyche

#endif