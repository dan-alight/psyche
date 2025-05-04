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
    ${PROJECT_SOURCE_DIR}/ext/pybind11/include
  )
  target_link_libraries(${TARGET} PRIVATE
    pybind11::embed # Necessary just to find Python.h.
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