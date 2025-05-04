#include "data_store.h"

#include <fstream>
#include <sstream>

#include "spdlog/spdlog.h"
#include "utils.h"

namespace psyche {
namespace {
constexpr int kSchemaVersion = 1;

std::string ReadSchemaFile() {
  std::string schema_path = GetExecutableDir() + "/resources/sql/schema.sql";
  std::ifstream schema_file(schema_path);
  if (!schema_file.is_open()) {
    spdlog::error("Failed to open schema file: {}", schema_path);
    return "";
  }
  std::stringstream buffer;
  buffer << schema_file.rdbuf();
  return buffer.str();
}
}  // namespace

DataStore::DataStore() {
  std::string db_path = GetExecutableDir() + "/sqlite.db";
  int rc = sqlite3_open(db_path.c_str(), &db_);
  if (rc != SQLITE_OK) {
    spdlog::error("Error opening database: {}", sqlite3_errmsg(db_));
    return;
  }

  // Apply schema
  std::string schema_sql = ReadSchemaFile();
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
  rc = sqlite3_prepare_v2(db_, "SELECT version FROM schema_version", -1, &select_stmt, nullptr);
  if (rc != SQLITE_OK) return;

  rc = sqlite3_step(select_stmt);
  sqlite3_finalize(select_stmt);
  if (rc == SQLITE_ROW) return;
  // No schema version exists, insert it
  sqlite3_stmt* insert_stmt = nullptr;
  const char* insert_sql = "INSERT INTO schema_version (version) VALUES (?)";
  rc = sqlite3_prepare_v2(db_, insert_sql, -1, &insert_stmt, nullptr);
  if (rc != SQLITE_OK) {
    spdlog::error("Error preparing schema version insert: {}", sqlite3_errmsg(db_));
    return;
  }

  rc = sqlite3_bind_int(insert_stmt, 1, kSchemaVersion);
  if (rc != SQLITE_OK) {
    spdlog::error("Error binding schema version: {}", sqlite3_errmsg(db_));
    sqlite3_finalize(insert_stmt);
    return;
  }

  rc = sqlite3_step(insert_stmt);
  if (rc != SQLITE_DONE) {
    spdlog::error("Error inserting schema version: {}", sqlite3_errmsg(db_));
  }
  sqlite3_finalize(insert_stmt);
}

DataStore::~DataStore() {
  sqlite3_close(db_);
}

sqlite3* DataStore::db() {
  return db_;
}

}  // namespace psyche