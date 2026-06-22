import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { env } from "@/env";
import * as schema from "@/db/schema";
import { oauthConfig, provider } from "@/db/schema";

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

  migrationDb
    .insert(provider)
    .values({
      key: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
    })
    .onConflictDoNothing()
    .run();

  const openaiProvider = migrationDb
    .select()
    .from(provider)
    .where(eq(provider.key, "openai"))
    .get();

  if (!openaiProvider) {
    throw new Error("OpenAI provider seed failed");
  }

  const openAiOAuthConfig = {
    providerId: openaiProvider.id,
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "api.connectors.read",
      "api.connectors.invoke",
    ],
    extraAuthorizeParams: {
      codex_cli_simplified_flow: "true",
      id_token_add_organizations: "true",
      originator: "psyche",
    },
    redirectUri: "http://localhost:1455/auth/callback",
  };
  const existingOpenAiOAuthConfig = migrationDb
    .select()
    .from(oauthConfig)
    .where(eq(oauthConfig.providerId, openaiProvider.id))
    .get();

  if (existingOpenAiOAuthConfig) {
    migrationDb
      .update(oauthConfig)
      .set(openAiOAuthConfig)
      .where(eq(oauthConfig.providerId, openaiProvider.id))
      .run();
  } else {
    migrationDb.insert(oauthConfig).values(openAiOAuthConfig).run();
  }
}

export function migrateDatabase() {
  migrateSqliteDatabase(sqlite);
}
