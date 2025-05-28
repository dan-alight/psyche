from pyplugin import log, Payload, PayloadFlags, to_string, InvokeCommand
import asyncio
from functools import partial
from psyche_agent.callback import receive_chat_input, receive_resource_info
import json

_invokable_registry = {}

def invokable(func):
  _invokable_registry[func.__name__] = func
  return func

def get_invokable(name):
  return _invokable_registry.get(name)

@invokable
async def compute(self, channel_id):
  # Create a new interrupt event for this channel
  event = asyncio.Event()
  self.compute_interrupt_events[channel_id] = event
  s = 0
  try:
    for i in range(100000000):
      if (i % 100000) == 0 and event.is_set():
        log(f"Compute interrupted at i={i} with sum {s}")
        break
      s += i
      if (i % 100000) == 0:
        await asyncio.sleep(0.0)    # Yield control to event loop
    else:
      log(f"Compute finished: {s}")
  finally:
    # Clean up event after computation
    self.compute_interrupt_events.pop(channel_id, None)

@invokable  
def interrupt(self, channel_id):
  event = self.compute_interrupt_events.get(channel_id)
  if event:
    event.set()
    log(f"Interrupt signal sent for channel {channel_id}")

@invokable
def get_chat_input_channel(self, channel_id):
  new_channel_id = self.interface.get_new_channel_id()
  callback = partial(receive_chat_input, self)
  self.interface.register_callback(new_channel_id, callback)
  flags = PayloadFlags.FINAL
  self.interface.send_payload(Payload(channel_id, new_channel_id, flags))

@invokable
def get_chat_output(self, channel_id):
  self.receiving_channels.append(channel_id)

