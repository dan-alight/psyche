cmake_minimum_required(VERSION 3.28)
project(Psyche
  VERSION 0.1.0
  LANGUAGES CXX C)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

include(dependencies)
include(plugins)

add_subdirectory(ext/spdlog)
add_subdirectory(ext/pybind11)

include(targets)

set(ENABLED_RESOURCES "" CACHE STRING "List of resources to build (or 'all'); empty to disable all resources")
set(ENABLED_AGENTS "" CACHE STRING "List of agents to build (or 'all'); empty to disable all agents")
message(STATUS "ENABLED_RESOURCES = ${ENABLED_RESOURCES}")
message(STATUS "ENABLED_AGENTS = ${ENABLED_AGENTS}")

process_plugin_directories("${PROJECT_SOURCE_DIR}/plugins/resources" "${ENABLED_RESOURCES}")
process_plugin_directories("${PROJECT_SOURCE_DIR}/plugins/agents" "${ENABLED_AGENTS}")

set(RESOURCE_COPY_LIST
  src/sql
)
set(RESOURCE_DESTINATION_DIR ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/resources)
string(REPLACE ";" "@@" RESOURCE_COPY_LIST_STR "${RESOURCE_COPY_LIST}")
add_custom_target(copy_resources ALL
  COMMAND ${CMAKE_COMMAND}
    -D RESOURCE_COPY_LIST_STR=${RESOURCE_COPY_LIST_STR}
    -D PROJECT_SOURCE_DIR=${PROJECT_SOURCE_DIR}
    -D RESOURCE_DESTINATION_DIR=${RESOURCE_DESTINATION_DIR}
    -D RESOURCE_DELIMITER=@@
    -P ${PROJECT_SOURCE_DIR}/cmake/copy_resources.cmake
  COMMENT "Copying project resources to build directory"
  VERBATIM
)
add_dependencies(Psyche copy_resources)

add_custom_target(final_cleanup ALL
  COMMAND ${CMAKE_COMMAND} 
    -D BUILD_DIR=${CMAKE_RUNTIME_OUTPUT_DIRECTORY}
    -P ${PROJECT_SOURCE_DIR}/cmake/cleanup.cmake
  VERBATIM
)

add_dependencies(final_cleanup Psyche)