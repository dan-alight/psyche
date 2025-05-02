set(PLUGIN_NAME "basic_agent")

add_library(${PLUGIN_NAME} SHARED
  basic_agent.cc
)

set(TO_COPY
  info.json
)
apply_standard_cpp_plugin_build_settings(${PLUGIN_NAME})
