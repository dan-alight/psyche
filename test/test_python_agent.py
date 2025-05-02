import sys
import os

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

from plugins.agents.python_agent import PythonAgent

def run_tests():
  a = PythonAgent()
  print(a.get_plugin_info())

if __name__ == "__main__":
  run_tests()
 