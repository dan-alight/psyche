set(PLUGIN_NAME "python_agent")

set(TO_COPY
  __init__.py
  python_agent.py
  info.json
  requirements.txt
)
apply_standard_python_plugin_build_settings(${PLUGIN_NAME})