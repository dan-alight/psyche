import os
import sys
import logging

class Plugin:
  pass

class Agent(Plugin):
  def __init__(self):
    pass

class Payload:
  def __init__(self):
    self.id = -1
    self.data = None
    self.size = 0
    self.offset = 0

  def __init__(self, id, data, size, offset):
    self.id = id
    self.data = data
    self.size = size
    self.offset = offset

class PluginInitializeStatus:
  SUCCESS = 0
  ERROR = 1

def to_string(data):
  return str(data)

def log(s):
  print(s)