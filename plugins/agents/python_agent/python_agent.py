from pyplugin import *
import json
from functools import wraps

# 1. Method Decorator: Marks methods (remains the same)
def register_invokable(func):
  """Decorator to mark a method as a remote invokable."""
  func._is_invokable = True

  @wraps(func)
  def wrapper(*args, **kwargs):
    return func(*args, **kwargs)

  # Return the original marked function if not modifying behavior
  return func

# 2. Base Class with __init_subclass__ for Collection Logic
class InvokableRegistrar:
  """Base class using __init_subclass__ to collect invokables."""
  _INVOKABLE_NAMES: set = set()    # Class variable type hint

  def __init_subclass__(cls, **kwargs):
    # Ensure cooperation with other potential __init_subclass__ in the MRO
    super().__init_subclass__(**kwargs)

    cls._INVOKABLE_NAMES = set()
    for name, member in cls.__dict__.items():
      if callable(member) and hasattr(
          member, '_is_invokable'
      ) and member._is_invokable:
        cls._INVOKABLE_NAMES.add(name)

    log(
        f"({cls.__name__}) Invokables collected via __init_subclass__: {cls._INVOKABLE_NAMES}"
    )

class PythonAgent(Agent, InvokableRegistrar):
  def get_plugin_info(self):
    return "Python Agent v1.0"

  def uninitialize(self):
    print("Agent uninitializing")

  def stop_stream(self, channel_id):
    self.receiving_channels = [
        id for id in self.receiving_channels if id != channel_id
    ]

  def invoke(self, channel_id, data, aux):
    command = json.loads(data)
    invokation = command.get('name')

    if invokation in self._INVOKABLES:
      method = getattr(self, invokation)
      method(channel_id, command, aux)

  def initialize(self, agent_interface):
    self.interface = agent_interface
    self.receiving_channels = []
    return PluginInitializeStatus.SUCCESS

  def plugin_added(self, plugin_info):
    pass

  def plugin_removed(self, name):
    pass

  @register_invokable
  def chat_out(self, channel_id, command, aux):
    self.receiving_channels.append(channel_id)

  @register_invokable
  def chat_in(self, channel_id, command, aux):
    new_channel_id = self.interface.get_new_channel_id()
    self.interface.register_callback(new_channel_id, self.receive_chat_input)
    flags = PayloadFlags.FINAL
    self.interface.send_payload(
        Payload(channel_id, new_channel_id, 8, 0, flags)
    )

  # Callbacks
  def receive_chat_input(self, payload):
    s = to_string(payload.data)
    s_len = len(s)
    for id in self.receiving_channels:
      self.interface.send_payload(Payload(id, s, s_len))
