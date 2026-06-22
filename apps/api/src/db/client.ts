import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { env } from "@/env";
import * as schema from "@/db/schema";

const sqlite = new Database(env.DATABASE_URL);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function migrateSqliteDatabase(database: Database.Database) {
  const migrationDb = drizzle(database, { schema });
  const migrationsFolder = fileURLToPath(
    new URL("../../drizzle", import.meta.url),
  );

  migrate(migrationDb, { migrationsFolder });
}

export function migrateDatabase() {
  migrateSqliteDatabase(sqlite);
}
