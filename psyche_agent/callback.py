from pyplugin import Payload, to_string, log
import json
from functools import partial
from openai import AsyncOpenAI

async def receive_chat_input(self, payload):
  chat_input = to_string(payload.data)

  response = await self.client.responses.create(
      model="gpt-4.1-nano",
      input=chat_input,
  )

  for id in self.receiving_channels:
    self.interface.send_payload(Payload(id, response.output_text, 0))

def receive_resource_info(self, payload):
  s = to_string(payload.data)
  j = json.loads(s)
  self.resource_info = j
  self.client = AsyncOpenAI(api_key=self.resource_info["api_keys"][0])
  self.interface.on_initialized(True)
