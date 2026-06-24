import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  conversation,
  type ConversationInsert,
  conversationItem,
  type ConversationItem,
  type ConversationItemInsert,
  conversationModelCall,
  type ConversationModelCall,
  type ConversationModelCallInsert,
  conversationModelCallToolUsage,
  type ConversationModelCallToolUsageInsert,
  conversationTranscriptItem,
  type ConversationTranscriptItem,
  type ConversationTranscriptItemInsert,
  toolDefinition,
  type ToolDefinitionInsert,
} from "@/db/schema";
import type {
  ModelFunctionCallInput,
  ModelClientTransport,
  ModelInput,
  ModelTool,
} from "@/modelClients/types";

export type ConversationState = {
  conversationId: number;
  previousResponseId?: string;
  items: ConversationItem[];
};

export type StartModelCallInput = {
  providerKey: string;
  model: string;
  transport: ModelClientTransport;
  tools?: ModelTool[];
  input: ModelInput[];
  transcriptUserPrompt?: string;
};

export type StartedModelCall = {
  conversationId: number;
  modelCallId: number;
  modelCall: ConversationModelCall;
  transcriptItems: ConversationTranscriptItem[];
  requestContext: {
    previousResponseId?: string;
    historyItems: ConversationItem[];
  };
  lifecycle: {
    createdConversation: boolean;
    createdModelCall: boolean;
  };
};

export type CompleteModelCallInput = {
  conversationId: number;
  modelCallId: number;
  responseId?: string;
  usage?: unknown;
  outputText?: string;
  functionCalls?: ModelFunctionCallInput[];
};

export type FailModelCallInput = {
  conversationId: number;
  modelCallId: number;
  responseId?: string;
  failure?: ConversationModelCallFailure;
};

export type AbortModelCallInput = {
  conversationId: number;
  modelCallId: number;
};

export type ConversationMutationResult = ConversationState & {
  modelCall: ConversationModelCall;
  transcriptItems: ConversationTranscriptItem[];
};

export type ConversationModelCallMutationResult = ConversationState & {
  modelCall: ConversationModelCall;
};

export type ConversationModelCallFailure = {
  message: string;
  code?: string;
  status?: number;
};

export type ConversationModelCallWithTranscriptItems = {
  modelCall: ConversationModelCall;
  transcriptItems: ConversationTranscriptItem[];
};

export type ConversationTranscriptItemInput =
  | {
      kind: "user_prompt";
      content: string;
    }
  | {
      kind: "assistant_output";
      content: string;
    }
  | {
      kind: "function_call";
      toolCallId: string;
      toolName: string;
      toolArguments: string;
    };

export type ConversationStore = {
  getState(conversationId: number): Promise<ConversationState>;
  getMaxTranscriptItemId(): Promise<number>;
  listTranscriptItemsAfterId(
    afterTranscriptItemId: number,
  ): Promise<ConversationTranscriptItem[]>;
  listRecentModelCallsWithTranscriptItems(input: {
    limit: number;
    statuses: ConversationModelCall["status"][];
  }): Promise<ConversationModelCallWithTranscriptItems[]>;
  startModelCall(input: StartModelCallInput): Promise<StartedModelCall>;
  completeModelCall(
    input: CompleteModelCallInput,
  ): Promise<ConversationMutationResult>;
  failModelCall(
    input: FailModelCallInput,
  ): Promise<ConversationModelCallMutationResult>;
  abortModelCall(
    input: AbortModelCallInput,
  ): Promise<ConversationModelCallMutationResult>;
  abortRunningModelCalls(): Promise<number>;
};

export function createDrizzleConversationStore(): ConversationStore {
  return {
    async getState(conversationId) {
      return getOrCreateState(conversationId);
    },
    async getMaxTranscriptItemId() {
      return selectMaxTranscriptItemId();
    },
    async listTranscriptItemsAfterId(afterTranscriptItemId) {
      return db
        .select()
        .from(conversationTranscriptItem)
        .where(gt(conversationTranscriptItem.id, afterTranscriptItemId))
        .orderBy(asc(conversationTranscriptItem.id))
        .all();
    },
    async listRecentModelCallsWithTranscriptItems(input) {
      return listRecentModelCallsWithTranscriptItems(input);
    },
    async startModelCall(input) {
      const now = new Date();

      return db.transaction((tx) => {
        const existing = selectActiveConversation(tx);
        const conversationId = existing
          ? existing.id
          : createConversation(tx, now);
        const runningModelCall = existing
          ? selectLatestRunningModelCall(tx, existing.id)
          : undefined;

        if (runningModelCall) {
          throw new Error(
            `Conversation '${conversationId}' already has running model call '${runningModelCall.id}'`,
          );
        }

        const previousResponseId = existing
          ? selectPreviousResponseId(tx, existing.id, input.transport)
          : undefined;
        const historyItems = selectCompletedConversationItems(
          tx,
          conversationId,
        );

        const modelCallInput: ConversationModelCallInsert = {
          conversationId,
          providerKey: input.providerKey,
          model: input.model,
          transport: input.transport,
          previousResponseId,
          status: "running",
          createdAt: now,
        };
        const modelCall = tx
          .insert(conversationModelCall)
          .values(modelCallInput)
          .returning()
          .get();

        persistModelCallToolUsage(tx, modelCall.id, input.tools, now);

        const firstSequence = nextSequence(tx, conversationId);
        const itemInputs = input.input.map((item, index) =>
          toConversationItemInsert({
            conversationId,
            modelCallId: modelCall.id,
            sequence: firstSequence + index,
            now,
            item,
          }),
        );

        if (itemInputs.length > 0) {
          tx.insert(conversationItem).values(itemInputs).run();
        }

        const transcriptItems = persistConversationTranscriptItems(tx, {
          conversationId,
          modelCallId: modelCall.id,
          now,
          items: input.transcriptUserPrompt
            ? [
                {
                  kind: "user_prompt",
                  content: input.transcriptUserPrompt,
                },
              ]
            : [],
        });

        return {
          conversationId,
          modelCallId: modelCall.id,
          modelCall,
          transcriptItems,
          requestContext: {
            previousResponseId,
            historyItems,
          },
          lifecycle: {
            createdConversation: !existing,
            createdModelCall: true,
          },
        };
      });
    },
    async completeModelCall(input) {
      const now = new Date();

      return db.transaction((tx) => {
        getRunningModelCall(tx, input.conversationId, input.modelCallId);
        const itemInputs = toAssistantConversationItemInserts({
          conversationId: input.conversationId,
          modelCallId: input.modelCallId,
          firstSequence: nextSequence(tx, input.conversationId),
          now,
          outputText: input.outputText,
          functionCalls: input.functionCalls ?? [],
        });

        const modelCall = tx
          .update(conversationModelCall)
          .set({
            responseId: input.responseId,
            status: "completed",
            failureMessage: null,
            failureCode: null,
            failureStatus: null,
            usage: input.usage,
            completedAt: now,
          })
          .where(eq(conversationModelCall.id, input.modelCallId))
          .returning()
          .get();

        tx.update(conversation)
          .set({ updatedAt: now })
          .where(eq(conversation.id, input.conversationId))
          .run();

        if (itemInputs.length > 0) {
          tx.insert(conversationItem).values(itemInputs).run();
        }

        const transcriptItems = persistConversationTranscriptItems(tx, {
          conversationId: input.conversationId,
          modelCallId: input.modelCallId,
          now,
          items: toCompletionTranscriptItems(input),
        });

        return {
          ...selectState(tx, input.conversationId),
          modelCall,
          transcriptItems,
        };
      });
    },
    async failModelCall(input) {
      const now = new Date();

      return db.transaction((tx) => {
        getRunningModelCall(tx, input.conversationId, input.modelCallId);

        const modelCall = tx
          .update(conversationModelCall)
          .set({
            responseId: input.responseId,
            status: "failed",
            failureMessage: input.failure?.message,
            failureCode: input.failure?.code,
            failureStatus: input.failure?.status,
            completedAt: now,
          })
          .where(eq(conversationModelCall.id, input.modelCallId))
          .returning()
          .get();

        tx.update(conversation)
          .set({ updatedAt: now })
          .where(eq(conversation.id, input.conversationId))
          .run();

        return {
          ...selectState(tx, input.conversationId),
          modelCall,
        };
      });
    },
    async abortModelCall(input) {
      const now = new Date();

      return db.transaction((tx) => {
        getRunningModelCall(tx, input.conversationId, input.modelCallId);

        const modelCall = tx
          .update(conversationModelCall)
          .set({
            status: "aborted",
            completedAt: now,
          })
          .where(eq(conversationModelCall.id, input.modelCallId))
          .returning()
          .get();

        tx.update(conversation)
          .set({ updatedAt: now })
          .where(eq(conversation.id, input.conversationId))
          .run();

        return {
          ...selectState(tx, input.conversationId),
          modelCall,
        };
      });
    },
    async abortRunningModelCalls() {
      const now = new Date();

      return db.transaction((tx) => {
        const aborted = tx
          .update(conversationModelCall)
          .set({
            status: "aborted",
            completedAt: now,
          })
          .where(eq(conversationModelCall.status, "running"))
          .returning({ conversationId: conversationModelCall.conversationId })
          .all();

        const conversationIds = new Set(
          aborted.map((modelCall) => modelCall.conversationId),
        );

        for (const conversationId of conversationIds) {
          tx.update(conversation)
            .set({ updatedAt: now })
            .where(eq(conversation.id, conversationId))
            .run();
        }

        return aborted.length;
      });
    },
  };
}

function persistModelCallToolUsage(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  modelCallId: number,
  tools: ModelTool[] | undefined,
  now: Date,
) {
  if (!tools || tools.length === 0) {
    return;
  }

  const seenToolDefinitionIds = new Set<number>();
  const usageInputs: ConversationModelCallToolUsageInsert[] = [];

  for (const tool of tools) {
    const toolDefinitionId = getOrCreateToolDefinition(tx, tool, now);

    if (seenToolDefinitionIds.has(toolDefinitionId)) {
      continue;
    }

    seenToolDefinitionIds.add(toolDefinitionId);
    usageInputs.push({
      modelCallId,
      toolDefinitionId,
      createdAt: now,
    });
  }

  if (usageInputs.length > 0) {
    tx.insert(conversationModelCallToolUsage)
      .values(usageInputs)
      .onConflictDoNothing()
      .run();
  }
}

function getOrCreateToolDefinition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tool: ModelTool,
  now: Date,
) {
  const definitionJson = toToolDefinitionJson(tool);
  const definitionKey = stableJsonStringify(definitionJson);
  const existing = tx
    .select({ id: toolDefinition.id })
    .from(toolDefinition)
    .where(eq(toolDefinition.definitionKey, definitionKey))
    .get();

  if (existing) {
    return existing.id;
  }

  const input: ToolDefinitionInsert = {
    name: tool.name,
    definitionKey,
    definitionJson,
    createdAt: now,
  };
  const created = tx
    .insert(toolDefinition)
    .values(input)
    .onConflictDoNothing()
    .returning({ id: toolDefinition.id })
    .get();

  if (created) {
    return created.id;
  }

  const selected = tx
    .select({ id: toolDefinition.id })
    .from(toolDefinition)
    .where(eq(toolDefinition.definitionKey, definitionKey))
    .get();

  if (!selected) {
    throw new Error(`Tool definition '${tool.name}' could not be persisted`);
  }

  return selected.id;
}

function toToolDefinitionJson(tool: ModelTool): Record<string, unknown> {
  return removeUndefined({
    type: tool.type,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict,
  });
}

function toConversationItemInsert(input: {
  conversationId: number;
  modelCallId: number;
  sequence: number;
  now: Date;
  item: ModelInput;
}): ConversationItemInsert {
  const base = {
    conversationId: input.conversationId,
    modelCallId: input.modelCallId,
    sequence: input.sequence,
    createdAt: input.now,
  };

  const item = input.item;

  if (item.type === "function_call_output") {
    return {
      ...base,
      kind: "function_call_output",
      toolCallId: item.callId,
      toolOutput: item.output,
    };
  }

  if (item.type === "function_call") {
    return {
      ...base,
      kind: "function_call",
      toolCallId: item.callId,
      toolName: item.name,
      toolArguments: item.arguments,
      providerItemId: item.providerItemId,
      rawProviderItem: item.rawProviderItem,
    };
  }

  if (item.type === "reasoning") {
    return {
      ...base,
      kind: "reasoning",
      providerItemId: item.providerItemId,
      rawProviderItem: item.rawProviderItem,
    };
  }

  return {
    ...base,
    kind: "message",
    role: item.role,
    content: item.content,
  };
}

function toAssistantConversationItemInserts(input: {
  conversationId: number;
  modelCallId: number;
  firstSequence: number;
  now: Date;
  outputText?: string;
  functionCalls: ModelFunctionCallInput[];
}): ConversationItemInsert[] {
  return [
    ...(input.outputText
      ? [
          {
            conversationId: input.conversationId,
            modelCallId: input.modelCallId,
            sequence: input.firstSequence,
            createdAt: input.now,
            kind: "message" as const,
            role: "assistant" as const,
            content: input.outputText,
          },
        ]
      : []),
    ...input.functionCalls.map((toolCall, index) => ({
      conversationId: input.conversationId,
      modelCallId: input.modelCallId,
      sequence: input.firstSequence + (input.outputText ? 1 : 0) + index,
      createdAt: input.now,
      kind: "function_call" as const,
      toolCallId: toolCall.callId,
      toolName: toolCall.name,
      toolArguments: toolCall.arguments,
      providerItemId: toolCall.providerItemId,
      rawProviderItem: toolCall.rawProviderItem,
    })),
  ];
}

function toCompletionTranscriptItems(
  input: CompleteModelCallInput,
): ConversationTranscriptItemInput[] {
  return [
    ...(input.functionCalls ?? []).map((toolCall) => ({
      kind: "function_call" as const,
      toolCallId: toolCall.callId,
      toolName: toolCall.name,
      toolArguments: toolCall.arguments,
    })),
    ...(input.outputText
      ? [
          {
            kind: "assistant_output" as const,
            content: input.outputText,
          },
        ]
      : []),
  ];
}

function persistConversationTranscriptItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    conversationId: number;
    modelCallId: number;
    now: Date;
    items: ConversationTranscriptItemInput[];
  },
) {
  if (input.items.length === 0) {
    return [];
  }

  const firstSequence = nextTranscriptSequence(tx, input.conversationId);
  const itemInputs = input.items.map((item, index) =>
    toConversationTranscriptItemInsert({
      conversationId: input.conversationId,
      modelCallId: input.modelCallId,
      sequence: firstSequence + index,
      now: input.now,
      item,
    }),
  );

  return tx
    .insert(conversationTranscriptItem)
    .values(itemInputs)
    .returning()
    .all();
}

function listRecentModelCallsWithTranscriptItems(input: {
  limit: number;
  statuses: ConversationModelCall["status"][];
}): ConversationModelCallWithTranscriptItems[] {
  const modelCalls = db
    .select()
    .from(conversationModelCall)
    .where(inArray(conversationModelCall.status, input.statuses))
    .orderBy(desc(conversationModelCall.id))
    .limit(input.limit)
    .all();

  if (modelCalls.length === 0) {
    return [];
  }

  const modelCallIds = modelCalls.map((modelCall) => modelCall.id);
  const transcriptItems = db
    .select()
    .from(conversationTranscriptItem)
    .where(inArray(conversationTranscriptItem.modelCallId, modelCallIds))
    .orderBy(asc(conversationTranscriptItem.id))
    .all();
  const transcriptItemsByModelCallId = new Map<
    number,
    ConversationTranscriptItem[]
  >();

  for (const item of transcriptItems) {
    if (item.modelCallId === null) {
      continue;
    }

    const existing = transcriptItemsByModelCallId.get(item.modelCallId);

    if (existing) {
      existing.push(item);
    } else {
      transcriptItemsByModelCallId.set(item.modelCallId, [item]);
    }
  }

  return modelCalls.map((modelCall) => ({
    modelCall,
    transcriptItems: transcriptItemsByModelCallId.get(modelCall.id) ?? [],
  }));
}

function selectMaxTranscriptItemId() {
  const latest = db
    .select({ id: conversationTranscriptItem.id })
    .from(conversationTranscriptItem)
    .orderBy(desc(conversationTranscriptItem.id))
    .limit(1)
    .get();

  return latest?.id ?? 0;
}

function toConversationTranscriptItemInsert(input: {
  conversationId: number;
  modelCallId: number;
  sequence: number;
  now: Date;
  item: ConversationTranscriptItemInput;
}): ConversationTranscriptItemInsert {
  const base = {
    conversationId: input.conversationId,
    modelCallId: input.modelCallId,
    sequence: input.sequence,
    createdAt: input.now,
  };

  if (input.item.kind === "user_prompt") {
    return {
      ...base,
      kind: "user_prompt",
      content: input.item.content,
    };
  }

  if (input.item.kind === "assistant_output") {
    return {
      ...base,
      kind: "assistant_output",
      content: input.item.content,
    };
  }

  return {
    ...base,
    kind: "function_call",
    toolCallId: input.item.toolCallId,
    toolName: input.item.toolName,
    toolArguments: input.item.toolArguments,
  };
}

function createConversation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  now: Date,
) {
  const conversationInput: ConversationInsert = {
    createdAt: now,
    updatedAt: now,
  };
  const created = tx
    .insert(conversation)
    .values(conversationInput)
    .returning()
    .get();

  return created.id;
}

function selectActiveConversation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  return tx
    .select()
    .from(conversation)
    .orderBy(desc(conversation.id))
    .limit(1)
    .get();
}

function selectLatestRunningModelCall(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
) {
  return tx
    .select()
    .from(conversationModelCall)
    .where(
      and(
        eq(conversationModelCall.conversationId, conversationId),
        eq(conversationModelCall.status, "running"),
      ),
    )
    .orderBy(desc(conversationModelCall.id))
    .limit(1)
    .get();
}

function selectPreviousResponseId(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
  transport?: ModelClientTransport,
) {
  const latest = tx
    .select({ responseId: conversationModelCall.responseId })
    .from(conversationModelCall)
    .where(
      and(
        eq(conversationModelCall.conversationId, conversationId),
        eq(conversationModelCall.status, "completed"),
        isNotNull(conversationModelCall.responseId),
        transport ? eq(conversationModelCall.transport, transport) : undefined,
      ),
    )
    .orderBy(desc(conversationModelCall.id))
    .limit(1)
    .get();

  return latest?.responseId ?? undefined;
}

function nextSequence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
) {
  const latest = tx
    .select({ sequence: conversationItem.sequence })
    .from(conversationItem)
    .where(eq(conversationItem.conversationId, conversationId))
    .orderBy(desc(conversationItem.sequence))
    .limit(1)
    .get();

  return latest ? latest.sequence + 1 : 0;
}

function nextTranscriptSequence(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
) {
  const latest = tx
    .select({ sequence: conversationTranscriptItem.sequence })
    .from(conversationTranscriptItem)
    .where(eq(conversationTranscriptItem.conversationId, conversationId))
    .orderBy(desc(conversationTranscriptItem.sequence))
    .limit(1)
    .get();

  return latest ? latest.sequence + 1 : 0;
}

function getModelCall(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
  modelCallId: number,
) {
  const modelCall = tx
    .select()
    .from(conversationModelCall)
    .where(eq(conversationModelCall.id, modelCallId))
    .get();

  if (!modelCall) {
    throw new Error(`Model call '${modelCallId}' was not found`);
  }

  if (modelCall.conversationId !== conversationId) {
    throw new Error(
      `Model call '${modelCallId}' belongs to conversation '${modelCall.conversationId}', not '${conversationId}'`,
    );
  }

  return modelCall;
}

function getRunningModelCall(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
  modelCallId: number,
) {
  const modelCall = getModelCall(tx, conversationId, modelCallId);

  if (modelCall.status !== "running") {
    throw new Error(
      `Model call '${modelCallId}' is '${modelCall.status}', not 'running'`,
    );
  }

  return modelCall;
}

function getOrCreateState(conversationId: number) {
  return db.transaction((tx) => {
    const now = new Date();
    const existing = tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .get();

    if (!existing) {
      tx.insert(conversation)
        .values({
          id: conversationId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return selectState(tx, conversationId);
  });
}

function selectState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
): ConversationState {
  const conversationRecord = tx
    .select()
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get();

  if (!conversationRecord) {
    throw new Error(`Conversation '${conversationId}' was not found`);
  }

  const items = selectConversationItems(tx, conversationId);

  return {
    conversationId,
    previousResponseId: selectPreviousResponseId(tx, conversationId),
    items,
  };
}

function selectConversationItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
) {
  return tx
    .select()
    .from(conversationItem)
    .where(eq(conversationItem.conversationId, conversationId))
    .orderBy(asc(conversationItem.sequence))
    .all();
}

function selectCompletedConversationItems(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
) {
  return tx
    .select(getTableColumns(conversationItem))
    .from(conversationItem)
    .innerJoin(
      conversationModelCall,
      eq(conversationItem.modelCallId, conversationModelCall.id),
    )
    .where(
      and(
        eq(conversationItem.conversationId, conversationId),
        eq(conversationModelCall.status, "completed"),
      ),
    )
    .orderBy(asc(conversationItem.sequence))
    .all();
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

function stableJsonStringify(value: unknown) {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .flatMap((key) => {
        const entryValue = value[key];

        return entryValue === undefined
          ? []
          : [[key, toStableJsonValue(entryValue)]];
      }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
