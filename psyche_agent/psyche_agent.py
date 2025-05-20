from pyplugin import Agent, InvokeCommand, log, to_string
import json
import asyncio
from psyche_agent.invokable import get_invokable
from psyche_agent.db import get_connection, close_connection
from functools import partial
from psyche_agent.callback import receive_resource_info
import inspect

class PsycheAgent(Agent):
  async def initialize(self, agent_interface):
    self.interface = agent_interface
    self.receiving_channels = []
    self.compute_interrupt_events = {}    # channel_id -> asyncio.Event
    self.resource_info = None

    await get_connection()

    resource_return_id = self.interface.get_new_channel_id()
    data = {
        "name": "get_resource_info",
    }
    ic = InvokeCommand(resource_return_id, "host", json.dumps(data))
    callback = partial(receive_resource_info, self)
    self.interface.invoke_with_callback(ic, callback)

  async def uninitialize(self):
    await close_connection()

  async def invoke(self, channel_id, data, aux):
    command = json.loads(data)
    invokation = command.get("name")
    func = get_invokable(invokation)
    if not func:
      return

    available_args = {
        "self": self,
        "channel_id": channel_id,
        "command": command,
        "aux": aux,
    }

    sig = inspect.signature(func)
    params = sig.parameters

    args_to_pass = [
        available_args[name] for name in params if name in available_args
    ]
    if asyncio.iscoroutinefunction(func):
      await func(*args_to_pass)
    else:
      func(*args_to_pass)

  def stop_stream(self, channel_id):
    self.receiving_channels = [
        id for id in self.receiving_channels if id != channel_id
    ]

  def plugin_added(self, plugin_info):
    pass

  def plugin_removed(self, name):
    pass
