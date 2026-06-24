import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  active: integer("active", { mode: "boolean" }).notNull().default(false)
}, (table) => [
  uniqueIndex("credential_provider_active_idx")
    .on(table.providerId)
    .where(sql`${table.active} = 1`)
]);

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

export const conversation = sqliteTable("conversation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});

export const conversationModelCall = sqliteTable("conversation_model_call", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  providerKey: text("provider_key").notNull(),
  model: text("model").notNull(),
  transport: text("transport", { enum: ["responses", "chat_completions"] })
    .notNull()
    .default("chat_completions"),
  previousResponseId: text("previous_response_id"),
  responseId: text("response_id"),
  status: text("status", { enum: ["running", "completed", "failed", "aborted"] }).notNull(),
  failureMessage: text("failure_message"),
  failureCode: text("failure_code"),
  failureStatus: integer("failure_status"),
  usage: text("usage", { mode: "json" }).$type<unknown>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" })
}, (table) => [
  index("conversation_model_call_conversation_idx").on(table.conversationId)
]);

export const toolDefinition = sqliteTable("tool_definition", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  definitionKey: text("definition_key").notNull(),
  definitionJson: text("definition_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => [
  uniqueIndex("tool_definition_key_idx").on(table.definitionKey),
  index("tool_definition_name_idx").on(table.name)
]);

export const conversationModelCallToolUsage = sqliteTable("conversation_model_call_tool_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modelCallId: integer("model_call_id")
    .notNull()
    .references(() => conversationModelCall.id, { onDelete: "cascade" }),
  toolDefinitionId: integer("tool_definition_id")
    .notNull()
    .references(() => toolDefinition.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("conversation_model_call_tool_usage_call_idx").on(table.modelCallId),
  index("conversation_model_call_tool_usage_definition_idx").on(table.toolDefinitionId),
  uniqueIndex("conversation_model_call_tool_usage_unique_idx").on(table.modelCallId, table.toolDefinitionId)
]);

export const conversationItem = sqliteTable("conversation_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  modelCallId: integer("model_call_id")
    .references(() => conversationModelCall.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind", { enum: ["message", "function_call", "function_call_output", "reasoning"] }).notNull(),
  role: text("role", { enum: ["system", "user", "assistant"] }),
  content: text("content"),
  toolCallId: text("tool_call_id"),
  toolName: text("tool_name"),
  toolArguments: text("tool_arguments"),
  toolOutput: text("tool_output"),
  providerItemId: text("provider_item_id"),
  rawProviderItem: text("raw_provider_item", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("conversation_item_conversation_idx").on(table.conversationId),
  uniqueIndex("conversation_item_conversation_sequence_idx").on(table.conversationId, table.sequence)
]);

export const conversationTranscriptItem = sqliteTable("conversation_transcript_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  modelCallId: integer("model_call_id")
    .references(() => conversationModelCall.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind", { enum: ["user_prompt", "function_call", "assistant_output"] }).notNull(),
  content: text("content"),
  toolCallId: text("tool_call_id"),
  toolName: text("tool_name"),
  toolArguments: text("tool_arguments"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull()
}, (table) => [
  index("conversation_transcript_item_conversation_idx").on(table.conversationId),
  index("conversation_transcript_item_model_call_idx").on(table.modelCallId),
  uniqueIndex("conversation_transcript_item_conversation_sequence_idx").on(table.conversationId, table.sequence)
]);

export type Conversation = typeof conversation.$inferSelect;
export type ConversationInsert = typeof conversation.$inferInsert;
export type ConversationItem = typeof conversationItem.$inferSelect;
export type ConversationItemInsert = typeof conversationItem.$inferInsert;
export type ConversationModelCall = typeof conversationModelCall.$inferSelect;
export type ConversationModelCallInsert = typeof conversationModelCall.$inferInsert;
export type ConversationModelCallToolUsageInsert = typeof conversationModelCallToolUsage.$inferInsert;
export type ConversationTranscriptItem = typeof conversationTranscriptItem.$inferSelect;
export type ConversationTranscriptItemInsert = typeof conversationTranscriptItem.$inferInsert;
export type ToolDefinitionInsert = typeof toolDefinition.$inferInsert;
