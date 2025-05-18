#include "data_store.h"

#include <string>
#include <string_view>

#include "spdlog/spdlog.h"
#include "utils.h"

namespace psyche {
namespace {
constexpr int kSchemaVersion = 1;
constexpr std::string_view kDbFile = "/sqlite.db";
constexpr std::string_view kSchemaFile = "/resources/sql/schema.sql";
constexpr std::string_view kMigrationsDir = "/resources/sql/migrations";
}  // namespace

DataStore::DataStore() {
  std::string exe_path = GetExecutableDir();
  std::string db_path = exe_path + kDbFile.data();
  int rc = sqlite3_open(db_path.c_str(), &db_);
  if (rc != SQLITE_OK) {
    spdlog::error("Error opening database: {}", sqlite3_errmsg(db_));
    return;
  }

  // Apply schema
  std::string schema_path = exe_path + kSchemaFile.data();
  std::string schema_sql = ReadFile(schema_path);
  if (schema_sql.empty()) return;
  char* err_msg = nullptr;
  rc = sqlite3_exec(db_, schema_sql.c_str(), nullptr, nullptr, &err_msg);
  if (rc != SQLITE_OK) {
    spdlog::error("Error applying schema: {}", err_msg);
    sqlite3_free(err_msg);
    return;
  }

  // Check if schema version exists
  sqlite3_stmt* select_stmt = nullptr;
  sqlite3_prepare_v2(db_, "SELECT version FROM schema_version", -1, &select_stmt, nullptr);
  rc = sqlite3_step(select_stmt);
  sqlite3_finalize(select_stmt);
  if (rc == SQLITE_ROW) return;

  // No schema version exists, insert it
  sqlite3_stmt* insert_stmt = nullptr;
  const char* insert_sql = "INSERT INTO schema_version (version) VALUES (?)";
  sqlite3_prepare_v2(db_, insert_sql, -1, &insert_stmt, nullptr);
  sqlite3_bind_int(insert_stmt, 1, kSchemaVersion);
  sqlite3_step(insert_stmt);
  sqlite3_finalize(insert_stmt);
}

DataStore::~DataStore() {
  sqlite3_close(db_);
}

sqlite3* DataStore::db() {
  return db_;
}

}  // namespace psyche