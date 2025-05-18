set(BUILD_SHARED_LIBS OFF)
add_library(sqlite3 STATIC
  ext/sqlite/sqlite3.c
)
target_include_directories(sqlite3 PUBLIC
  ${PROJECT_SOURCE_DIR}/ext/sqlite
)
target_compile_definitions(sqlite3 PRIVATE
  SQLITE_THREADSAFE=1
  SQLITE_ENABLE_JSON1
)

add_executable(Psyche
  src/main.cc
  src/executor.cc
  src/websockets_server.cc
  src/plugin_manager.cc
  src/message_processor.cc
  src/utils.cc
  src/pyplugin.cc
  src/asyncio_loop.cc
  src/cppplugin.cc
  src/data_store.cc
  src/command_handler.cc
)

set_target_properties(Psyche PROPERTIES
  CXX_EXTENSIONS OFF  
)

target_compile_features(Psyche PRIVATE cxx_std_23)

target_compile_definitions(Psyche PRIVATE)

target_include_directories(Psyche PRIVATE
  ${PROJECT_SOURCE_DIR}/include/psyche
  ${PROJECT_SOURCE_DIR}/ext/rapidjson/include
  ${PROJECT_SOURCE_DIR}/ext/moodycamel/include
  ${PROJECT_SOURCE_DIR}/ext/recursive-variant/include
  ${PROJECT_SOURCE_DIR}/ext/pybind11/include
  ${PROJECT_SOURCE_DIR}/ext/sqlite/
)

target_link_libraries(Psyche PRIVATE
  unofficial::uwebsockets::uwebsockets
  spdlog::spdlog
  pybind11::embed
  sqlite3
) 