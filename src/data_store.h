#ifndef PSYCHE_DATA_STORE_H_
#define PSYCHE_DATA_STORE_H_

#include "sqlite3.h"

namespace psyche {
class DataStore {
 public:
  DataStore();
  ~DataStore();
  sqlite3* db();
 private:
  sqlite3* db_;
};
}  // namespace psyche

#endif