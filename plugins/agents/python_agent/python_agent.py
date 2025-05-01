from pyplugin import *
import json
import asyncio
from .invokable import get_invokable

class PythonAgent(Agent):
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
    invokation = command.get('name')
    func = get_invokable(invokation)
    if func:
      if asyncio.iscoroutinefunction(func):
        await func(self, channel_id, command, aux)
      else:
        func(self, channel_id, command, aux)
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
