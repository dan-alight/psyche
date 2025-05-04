#include "command_handler.h"

namespace psyche {
CommandHandler::CommandHandler(DataStore& data_store) : data_store_(data_store) {
}

void CommandHandler::Invoke(int64_t channel_id, std::string data, std::shared_ptr<void> aux) {
}
void CommandHandler::StopStream(int64_t channel_id) {
}
}  // namespace psyche