class Plugin:
  pass
  
class Agent(Plugin):
  def __init__(self):
    pass

class PayloadFlags:
  FINAL = 1 << 0
  ERROR = 1 << 1

class Payload:
  def set_flags(self, id, data, size, offset, flags):
    self.id = id
    self.data = data
    self.size = size
    self.offset = offset
    self.flags = flags

  def __init__(self):
    self.set_flags(-1, None, 0, 0, 0)

  def __init__(self, id, data, size, offset = 0, flags = 0):
    self.set_flags(id, data, size, offset, flags)

class PluginInitializeStatus:
  SUCCESS = 0
  ERROR = 1

def to_string(data):
  return str(data)

def log(s):
  print(s)
