# Script to remove all .exp files in the build directory
# This script is called from the main CMakeLists.txt

# Get all .exp files recursively
file(GLOB_RECURSE EXP_FILES "${BUILD_DIR}/*.exp")

if(EXP_FILES)
  foreach(FILE ${EXP_FILES})
    file(REMOVE "${FILE}")
  endforeach()
endif()