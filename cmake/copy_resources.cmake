file(MAKE_DIRECTORY ${RESOURCE_DESTINATION_DIR})

string(REPLACE ${RESOURCE_DELIMITER} ";" RESOURCE_COPY_LIST "${RESOURCE_COPY_LIST_STR}")

function(copy_file_incrementally src_file dst_dir)
    cmake_path(GET src_file FILENAME filename)
    set(dst_file "${dst_dir}/${filename}")
    
    if(NOT EXISTS "${dst_file}")
        message(STATUS "Copying new file: ${src_file} -> ${dst_file}")
        file(COPY "${src_file}" DESTINATION "${dst_dir}")
        return()
    endif()
    
    file(TIMESTAMP "${src_file}" src_time)
    file(TIMESTAMP "${dst_file}" dst_time)
    
    if(NOT "${src_time}" STREQUAL "${dst_time}")
        message(STATUS "Updating modified file: ${src_file} -> ${dst_file}")
        file(COPY "${src_file}" DESTINATION "${dst_dir}")
    endif()
endfunction()

function(copy_directory_recursively src_dir dst_dir)
    file(GLOB_RECURSE all_files LIST_DIRECTORIES false "${src_dir}/*")
    
    foreach(file ${all_files})
        file(RELATIVE_PATH rel_path "${src_dir}" "${file}")
        
        cmake_path(GET rel_path PARENT_PATH rel_dir)

        set(this_dst_dir "${dst_dir}")
        if(NOT "${rel_dir}" STREQUAL "")
            set(this_dst_dir "${dst_dir}/${rel_dir}")
            file(MAKE_DIRECTORY "${this_dst_dir}")
        endif()

        copy_file_incrementally("${file}" "${this_dst_dir}")
    endforeach()
endfunction()

foreach(RESOURCE_PATH ${RESOURCE_COPY_LIST})
    set(SOURCE_FULL_PATH "${PROJECT_SOURCE_DIR}/${RESOURCE_PATH}")
    cmake_path(NORMAL_PATH SOURCE_FULL_PATH OUTPUT_VARIABLE SOURCE_FULL_PATH)

    if(NOT EXISTS ${SOURCE_FULL_PATH})
        message(WARNING "Resource path does not exist, skipping: ${SOURCE_FULL_PATH}")
        continue()
    endif()

    if(IS_DIRECTORY ${SOURCE_FULL_PATH})
        cmake_path(GET RESOURCE_PATH FILENAME RESOURCE_NAME)
        set(DESTINATION_SUBDIR "${RESOURCE_DESTINATION_DIR}/${RESOURCE_NAME}")
        file(MAKE_DIRECTORY "${DESTINATION_SUBDIR}")
        copy_directory_recursively("${SOURCE_FULL_PATH}" "${DESTINATION_SUBDIR}")
    else()
        copy_file_incrementally("${SOURCE_FULL_PATH}" "${RESOURCE_DESTINATION_DIR}")
    endif()
endforeach()
