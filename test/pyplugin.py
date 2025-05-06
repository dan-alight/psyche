class Plugin:
  pass

class Agent(Plugin):
  def __init__(self):
    pass

class PayloadFlags:
  FINAL = 1 << 0
  ERROR = 1 << 1

class Payload:
  def __init__(self, id=-1, data=None, size=0, offset=0, flags=0):
    self.id = id
    self.data = data
    self.size = size
    self.offset = offset
    self.flags = flags

class PluginInitializeStatus:
  SUCCESS = 0
  ERROR = 1

class InvokableCommand:
  def __init__(self, id=-1, to="", data="", aux=None):
    self.id = id
    self.to = to
    self.data = data
    self.aux = aux

def to_string(data):
  return str(data)

def log(s):
  print(s)
