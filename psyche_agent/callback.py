from pyplugin import Payload, to_string

def receive_chat_input(self, payload):
  pass
  """ s = to_string(payload.data)
  s_len = len(s)
  for id in self.receiving_channels:
    self.interface.send_payload(Payload(id, s, s_len)) """