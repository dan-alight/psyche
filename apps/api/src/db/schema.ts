import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const provider = sqliteTable("provider", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull()
});

export const credential = sqliteTable("credential", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id")
    .notNull()
    .references(() => provider.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["api_key", "oauth"] }).notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" })
});

export const model = sqliteTable(
  "model",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => provider.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    name: text("name").notNull()
  },
  (table) => [
    uniqueIndex("model_provider_model_id_idx").on(table.providerId, table.modelId)
  ]
);

export const oauthConfig = sqliteTable("oauth_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id")
    .notNull()
    .references(() => provider.id, { onDelete: "cascade" }),
  authorizeUrl: text("authorize_url").notNull(),
  tokenUrl: text("token_url").notNull(),
  clientId: text("client_id").notNull(),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  extraAuthorizeParams: text("extra_authorize_params", { mode: "json" }).$type<Record<string, string>>().notNull(),
  redirectUri: text("redirect_uri").notNull()
});
