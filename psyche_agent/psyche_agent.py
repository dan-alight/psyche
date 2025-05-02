from pyplugin import Agent, PluginInitializeStatus
import json
import asyncio
from psyche_agent.invokable import get_invokable
import inspect
from mem0 import Memory

class PsycheAgent(Agent):
  def get_plugin_info(self):
    return "Python Agent v1.0"

  def uninitialize(self):
    pass

  def stop_stream(self, channel_id):
    self.receiving_channels = [
        id for id in self.receiving_channels if id != channel_id
    ]

  async def invoke(self, channel_id, data, aux):
    command = json.loads(data)
    invokation = command.get("name")
    func = get_invokable(invokation)
    if not func:
      return
    # Build available arguments
    available_args = {
        "self": self,
        "channel_id": channel_id,
        "command": command,
        "aux": aux,
    }
    # Get the function's parameter names
    sig = inspect.signature(func)
    params = sig.parameters
    # Build the args to pass
    args_to_pass = [
        available_args[name] for name in params if name in available_args
    ]
    if asyncio.iscoroutinefunction(func):
      await func(*args_to_pass)
    else:
      func(*args_to_pass)
    # else: silently ignore unknown commands (could log or raise)

  def initialize(self, agent_interface):
    self.interface = agent_interface
    self.receiving_channels = []
    self._compute_interrupt_events = {}    # channel_id -> asyncio.Event
    return PluginInitializeStatus.SUCCESS

  def plugin_added(self, plugin_info):
    pass

  def plugin_removed(self, name):
    pass
