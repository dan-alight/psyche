from pyplugin import Payload, to_string, log
import json
from functools import partial

async def receive_chat_input(self, payload):
  if self.resource_info is None:
    log("Resource info not available yet")
    return
  for id in self.receiving_channels:
    # Just sending it back for now    
    self.interface.send_payload(Payload(id, to_string(payload.data), 0))
  

def receive_resource_info(self, payload):
  s = to_string(payload.data)
  log(s)
  j = json.loads(s)
  self.resource_info = j
  self.interface.on_initialized()