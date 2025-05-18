from pyplugin import Payload, to_string, log
import json

def receive_chat_input(self, payload):
  pass
  """ s = to_string(payload.data)
  s_len = len(s)
  for id in self.receiving_channels:
    self.interface.send_payload(Payload(id, s, s_len)) """

def receive_resource_info(self, payload):
  s = to_string(payload.data)
  j = json.loads(s)
  self.resource_info = j
  api_keys = j['api_keys']
  #log(str(self.asdf))
  for key in api_keys:
    log(key)