cmake_policy(SET CMP0009 NEW) # Required for file GLOB_RECURSE
file(GLOB_RECURSE EXP_FILES FOLLOW_SYMLINKS "${BUILD_DIR}/*.exp")
if(EXP_FILES)
  foreach(FILE ${EXP_FILES})
    file(REMOVE "${FILE}")
  endforeach()
endif()
