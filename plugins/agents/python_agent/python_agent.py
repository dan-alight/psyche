from pyplugin import *
import json

class PythonAgent(Agent):
  def get_plugin_info(self):
    return "Python Agent v1.0"

  def uninitialize(self):
    print("Agent uninitializing")

  def receive_chat_input(self, payload):
    s = to_string(payload.data)
    s_len = len(s)
    for id in self.receiving_channels:
      self.interface.send_payload(Payload(id, s, s_len))

  def invoke(self, channel_id, data, aux):
    command = json.loads(data)
    if command['name'] == 'chat_out':
      self.receiving_channels.append(channel_id)
    elif command['name'] == 'chat_in':
      new_channel_id = self.interface.get_new_channel_id()
      self.interface.register_callback(new_channel_id, self.receive_chat_input)
      self.interface.send_payload(Payload(channel_id, new_channel_id, 8))

  def stop_stream(self, channel_id):
    self.receiving_channels = [
        id for id in self.receiving_channels if id != channel_id
    ]

  def initialize(self, agent_interface):
    self.interface = agent_interface
    self.receiving_channels = []
    return PluginInitializeStatus.SUCCESS

  def plugin_added(self, plugin_info):
    print(f"Plugin added: {plugin_info}")

  def plugin_removed(self, name):
    print(f"Plugin removed: {name}")
