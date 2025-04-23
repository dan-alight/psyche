cmake_minimum_required(VERSION 3.22)
project(Psyche
  VERSION 0.1.0
  LANGUAGES CXX C)

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/$<CONFIG>)

function(get_all_targets VAR DIR)
  get_property(TARGETS DIRECTORY ${DIR} PROPERTY BUILDSYSTEM_TARGETS)
  get_property(SUBDIRS DIRECTORY ${DIR} PROPERTY SUBDIRECTORIES)
  foreach(SUBDIR ${SUBDIRS})
    get_all_targets(SUBTARGETS ${SUBDIR})
    list(APPEND TARGETS ${SUBTARGETS})
  endforeach()
  set(${VAR} ${TARGETS} PARENT_SCOPE)
endfunction()

find_package(unofficial-uwebsockets CONFIG REQUIRED)
set(Python3_FIND_VERSION 3.12)
find_package(Python3 COMPONENTS Interpreter Development REQUIRED)

set(BUILD_SHARED_LIBS OFF)
add_subdirectory(ext/spdlog)

add_subdirectory(ext/pybind11)

add_executable(Psyche
  src/main.cc
  src/executor.cc
  src/websockets_server.cc
  src/plugin_manager.cc
  src/message_processor.cc
  src/utils.cc
  src/pyplugin.cc
  src/asyncio_loop.cc
)

set_target_properties(Psyche PROPERTIES
  CXX_EXTENSIONS OFF
)

target_compile_features(Psyche PRIVATE cxx_std_23)

target_compile_definitions(Psyche PRIVATE
  
)

target_include_directories(Psyche PRIVATE
  ${PROJECT_SOURCE_DIR}/include/psyche
  ${PROJECT_SOURCE_DIR}/ext/rapidjson/include
  ${PROJECT_SOURCE_DIR}/ext/moodycamel/include
  ${PROJECT_SOURCE_DIR}/ext/recursive-variant/include
  ${PROJECT_SOURCE_DIR}/ext/pybind11/include
)

target_link_libraries(Psyche PRIVATE
  unofficial::uwebsockets::uwebsockets
  spdlog::spdlog
  pybind11::embed
)

set(PLUGIN_OUTPUT_BASE ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/plugins CACHE INTERNAL "Base output directory for plugins")
function(apply_standard_plugin_build_settings PLUGIN_NAME)
  cmake_path(GET CMAKE_CURRENT_SOURCE_DIR PARENT_PATH PLUGIN_DIR)
  cmake_path(GET PLUGIN_DIR FILENAME PLUGIN_TYPE)

  set(PLUGIN_OUTPUT_DIR ${PLUGIN_OUTPUT_BASE}/${PLUGIN_TYPE}/${PLUGIN_NAME})
  set(PLUGIN_OUTPUT_DIR ${PLUGIN_OUTPUT_DIR} PARENT_SCOPE)

  if(DEFINED TO_COPY)
    set(COPY_OUTPUTS "")

    foreach(FILE ${TO_COPY})
      if(IS_ABSOLUTE ${FILE})
        set(SOURCE_FILE ${FILE})
      else()
        set(SOURCE_FILE ${CMAKE_CURRENT_SOURCE_DIR}/${FILE})
      endif()

      cmake_path(GET SOURCE_FILE FILENAME FILE_NAME)
      set(OUTPUT_FILE ${PLUGIN_OUTPUT_DIR}/${FILE_NAME})

      add_custom_command(
        OUTPUT ${OUTPUT_FILE}
        COMMAND ${CMAKE_COMMAND} -E make_directory ${PLUGIN_OUTPUT_DIR}
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                ${SOURCE_FILE}
                ${OUTPUT_FILE}
        DEPENDS ${SOURCE_FILE}
        COMMENT "Copying ${FILE_NAME} to plugin output directory"
      )

      list(APPEND COPY_OUTPUTS ${PLUGIN_OUTPUT_DIR}/${FILE_NAME})
    endforeach()

    add_custom_target(${PLUGIN_NAME}Copy ALL
      DEPENDS ${COPY_OUTPUTS}
    )
  else()
    message(WARNING "No 'TO_COPY' variable defined for plugin ${PLUGIN_NAME}")
  endif()
endfunction()

function(apply_standard_cpp_plugin_build_settings TARGET)
  apply_standard_plugin_build_settings(${PLUGIN_NAME})

  target_include_directories(${TARGET} PRIVATE 
    ${PROJECT_SOURCE_DIR}/include/psyche
    ${PROJECT_SOURCE_DIR}/ext/rapidjson/include
  )
  target_compile_features(${TARGET} PRIVATE cxx_std_23)
  set_target_properties(${TARGET} PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${PLUGIN_OUTPUT_DIR}
    RUNTIME_OUTPUT_DIRECTORY ${PLUGIN_OUTPUT_DIR}
    ARCHIVE_OUTPUT_DIRECTORY ${PLUGIN_OUTPUT_DIR}
  )
  add_custom_command(TARGET ${TARGET} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E remove 
      "$<TARGET_FILE_DIR:${TARGET}>/${TARGET}.exp"
      "$<TARGET_FILE_DIR:${TARGET}>/${TARGET}.lib"
)
endfunction()

function(apply_standard_python_plugin_build_settings PLUGIN_NAME)
  apply_standard_plugin_build_settings(${PLUGIN_NAME})
endfunction()

function(process_plugin_directories BASE_DIR ENABLED_LIST)
  if("${ENABLED_LIST}" STREQUAL "")
    return()
  endif()
  
  file(GLOB plugin_dirs LIST_DIRECTORIES true ${BASE_DIR}/*)
  foreach(dir ${plugin_dirs})
    if(IS_DIRECTORY ${dir} AND EXISTS ${dir}/CMakeLists.txt)
      cmake_path(GET dir FILENAME plugin_name)
      if("${ENABLED_LIST}" STREQUAL "all" OR ";${ENABLED_LIST};" MATCHES ";${plugin_name};")
        add_subdirectory(${dir})
      endif()
    endif()
  endforeach()
endfunction()

set(ENABLED_RESOURCES "" CACHE STRING "List of resources to build (or 'all'); empty to disable all resources")
set(ENABLED_AGENTS "" CACHE STRING "List of agents to build (or 'all'); empty to disable all agents")
message(STATUS "ENABLED_RESOURCES = ${ENABLED_RESOURCES}")
message(STATUS "ENABLED_AGENTS = ${ENABLED_AGENTS}")

process_plugin_directories("${PROJECT_SOURCE_DIR}/plugins/resources" "${ENABLED_RESOURCES}")
process_plugin_directories("${PROJECT_SOURCE_DIR}/plugins/agents" "${ENABLED_AGENTS}")

add_custom_target(final_cleanup ALL
  COMMAND ${CMAKE_COMMAND} 
    -D BUILD_DIR=${CMAKE_RUNTIME_OUTPUT_DIRECTORY}
    -P ${PROJECT_SOURCE_DIR}/cmake/cleanup_exp.cmake
  VERBATIM
)

add_dependencies(final_cleanup 
  Psyche
)