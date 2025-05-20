from pyplugin import Payload, to_string, log
import json

async def receive_chat_input(self, payload):
  if self.resource_info is None:
    log("Resource info not available yet.")
    return
  log("Received chat input: "+ to_string(payload.data))
    

def receive_resource_info(self, payload):
  s = to_string(payload.data)
  j = json.loads(s)
  self.resource_info = j
  api_keys = j['api_keys']
  #log(str(self.asdf))
  for key in api_keys:
    log(key)