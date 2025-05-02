set(PLUGIN_NAME "psyche_agent")

set(TO_COPY
  __init__.py
  psyche_agent.py
  info.json
  requirements.txt
)
apply_standard_python_plugin_build_settings(${PLUGIN_NAME})