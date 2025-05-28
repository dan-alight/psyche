import aiosqlite
import os
import pathlib

_connection = None
_SCHEMA_VERSION = 1    # Increment this when you modify schema.sql

async def _init_schema(conn: aiosqlite.Connection) -> None:
  """Initialize the database schema if it hasn't been applied yet."""
  # Check if schema has been applied
  async with conn.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ) as cursor:
    # Always apply schema on first connection
    schema_path = pathlib.Path(__file__).parent / "schema.sql"
    with open(schema_path, "r", encoding="utf-8") as f:
      schema_sql = f.read()
    await conn.executescript(schema_sql)
    
    if not await cursor.fetchone():
      await conn.execute(
          "INSERT INTO schema_version (version) VALUES (?)",
          (_SCHEMA_VERSION, )
      )
      await conn.commit()
    else:
      # Check if we need to update schema
      async with conn.execute(
          "SELECT MAX(version) FROM schema_version"
      ) as cursor:
        current_version = await cursor.fetchone()
        if current_version and current_version[0] < _SCHEMA_VERSION:
          # Here you would handle schema updates if needed
          # For now, just update the version
          await conn.execute(
              "INSERT INTO schema_version (version) VALUES (?)",
              (_SCHEMA_VERSION, )
          )
          await conn.commit()

async def get_connection():
  """Get or create a database connection with initialized schema."""
  global _connection
  if _connection is None:
    db_path = pathlib.Path(__file__).parent / "sqlite.db"
    _connection = await aiosqlite.connect(db_path)
    await _connection.execute("PRAGMA foreign_keys = ON;")  # Enable foreign keys
    await _init_schema(_connection)
  return _connection

async def close_connection():
  """Close the database connection if it exists."""
  global _connection
  if _connection is not None:
    await _connection.close()
    _connection = None
