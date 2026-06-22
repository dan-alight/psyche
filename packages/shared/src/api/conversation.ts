import { z } from "zod";

export const conversationModelCallStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "aborted",
]);

export const conversationModelCallTransportSchema = z.enum([
  "responses",
  "chat_completions",
]);

export const conversationTranscriptItemKindSchema = z.enum([
  "user_prompt",
  "function_call",
  "assistant_output",
]);

export const conversationModelCallSchema = z.object({
  id: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  providerKey: z.string(),
  model: z.string(),
  transport: conversationModelCallTransportSchema,
  previousResponseId: z.string().nullable(),
  responseId: z.string().nullable(),
  status: conversationModelCallStatusSchema,
  usage: z.unknown().nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});

export const conversationTranscriptItemSchema = z.object({
  id: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  modelCallId: z.number().int().positive().nullable(),
  sequence: z.number().int().nonnegative(),
  kind: conversationTranscriptItemKindSchema,
  content: z.string().nullable(),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  toolArguments: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const conversationModelCallWithTranscriptItemsSchema = z.object({
  modelCall: conversationModelCallSchema,
  transcriptItems: z.array(conversationTranscriptItemSchema),
});

export const conversationRecentModelCallsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const conversationRecentModelCallsResponseSchema = z.object({
  modelCalls: z.array(conversationModelCallWithTranscriptItemsSchema),
});

export const conversationStreamQuerySchema = z.object({
  afterTranscriptItemId: z.coerce.number().int().nonnegative().default(0),
});

export const conversationTranscriptItemEventSchema = z.object({
  type: z.literal("transcript_item"),
  item: conversationTranscriptItemSchema,
});

export const conversationTextDeltaEventSchema = z.object({
  type: z.literal("text_delta"),
  liveEventId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  modelCallId: z.number().int().positive(),
  afterTranscriptItemId: z.number().int().nonnegative(),
  delta: z.string(),
});

export const conversationLiveEventSchema = z.discriminatedUnion("type", [
  conversationTranscriptItemEventSchema,
  conversationTextDeltaEventSchema,
]);

export type ConversationModelCallStatus = z.infer<
  typeof conversationModelCallStatusSchema
>;
export type ConversationModelCallTransport = z.infer<
  typeof conversationModelCallTransportSchema
>;
export type ConversationTranscriptItemKind = z.infer<
  typeof conversationTranscriptItemKindSchema
>;
export type ConversationModelCall = z.infer<typeof conversationModelCallSchema>;
export type ConversationTranscriptItem = z.infer<
  typeof conversationTranscriptItemSchema
>;
export type ConversationModelCallWithTranscriptItems = z.infer<
  typeof conversationModelCallWithTranscriptItemsSchema
>;
export type ConversationRecentModelCallsQuery = z.infer<
  typeof conversationRecentModelCallsQuerySchema
>;
export type ConversationRecentModelCallsResponse = z.infer<
  typeof conversationRecentModelCallsResponseSchema
>;
export type ConversationStreamQuery = z.infer<
  typeof conversationStreamQuerySchema
>;
export type ConversationLiveEvent = z.infer<typeof conversationLiveEventSchema>;
