import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  conversation,
  type ConversationInsert,
  conversationItem,
  type ConversationItem,
  type ConversationItemInsert,
  conversationModelCall,
  type ConversationModelCallInsert,
  conversationModelCallTool,
  type ConversationModelCallToolInsert,
} from "@/db/schema";
import { toResponsesTools } from "@/modelClients/requestMapping";
import type {
  ModelFunctionCallInput,
  ModelInput,
  ModelTool,
} from "@/modelClients/types";

export type ConversationState = {
  conversationId: number;
  previousResponseId?: string;
  items: ConversationItem[];
};

export type AppendConversationModelCallInput = {
  conversationId?: number;
  providerKey: string;
  model: string;
  previousResponseId?: string;
  responseId?: string;
  usage?: unknown;
  tools?: ModelTool[];
  input: ModelInput[];
  outputText?: string;
  functionCalls?: ModelFunctionCallInput[];
};

export type ConversationStore = {
  getState(
    conversationId: number,
    providerKey: string,
  ): Promise<ConversationState>;
  appendModelCall(
    input: AppendConversationModelCallInput,
  ): Promise<ConversationState>;
};

export function createDrizzleConversationStore(): ConversationStore {
  return {
    async getState(conversationId, providerKey) {
      return getOrCreateState(conversationId, providerKey);
    },
    async appendModelCall(input) {
      const now = new Date();

      return db.transaction((tx) => {
        const existing =
          input.conversationId === undefined
            ? undefined
            : tx
                .select()
                .from(conversation)
                .where(eq(conversation.id, input.conversationId))
                .get();

        if (existing && existing.providerKey !== input.providerKey) {
          throw new Error(
            `Conversation '${input.conversationId}' belongs to provider '${existing.providerKey}', not '${input.providerKey}'`,
          );
        }

        const conversationId = existing
          ? updateExistingConversation(tx, existing.id, input, now)
          : createConversation(tx, input, now);

        const modelCallInput: ConversationModelCallInsert = {
          conversationId,
          providerKey: input.providerKey,
          model: input.model,
          previousResponseId: input.previousResponseId,
          responseId: input.responseId,
          status: "completed",
          usage: input.usage,
          createdAt: now,
          completedAt: now,
        };
        const modelCall = tx
          .insert(conversationModelCall)
          .values(modelCallInput)
          .returning()
          .get();

        const toolDefinitions = toResponsesTools(input.tools) ?? [];
        const toolInputs: ConversationModelCallToolInsert[] =
          toolDefinitions.flatMap((definition) => {
            const name =
              typeof definition.name === "string" ? definition.name : undefined;

            return name
              ? [
                  {
                    modelCallId: modelCall.id,
                    name,
                    definitionJson: definition,
                    createdAt: now,
                  },
                ]
              : [];
          });

        if (toolInputs.length > 0) {
          tx.insert(conversationModelCallTool).values(toolInputs).run();
        }

        const itemInputs = toConversationItemInserts({
          conversationId,
          modelCallId: modelCall.id,
          firstSequence: nextSequence(tx, conversationId),
          now,
          input: input.input,
          outputText: input.outputText,
          functionCalls: input.functionCalls ?? [],
          providerResponseId: input.responseId,
        });

        if (itemInputs.length > 0) {
          tx.insert(conversationItem).values(itemInputs).run();
        }

        return selectState(tx, conversationId, input.providerKey);
      });
    },
  };
}

function toConversationItemInserts(input: {
  conversationId: number;
  modelCallId: number;
  firstSequence: number;
  now: Date;
  input: ModelInput[];
  outputText?: string;
  functionCalls: ModelFunctionCallInput[];
  providerResponseId?: string;
}) {
  return [
    ...input.input.map((item, index) =>
      toConversationItemInsert({
        conversationId: input.conversationId,
        modelCallId: input.modelCallId,
        sequence: input.firstSequence + index,
        now: input.now,
        item,
      }),
    ),
    ...toAssistantConversationItemInserts({
      conversationId: input.conversationId,
      modelCallId: input.modelCallId,
      firstSequence: input.firstSequence + input.input.length,
      now: input.now,
      outputText: input.outputText,
      functionCalls: input.functionCalls,
      providerResponseId: input.providerResponseId,
    }),
  ];
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
  providerResponseId?: string;
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
            providerResponseId: input.providerResponseId,
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
      providerResponseId: input.providerResponseId,
      providerItemId: toolCall.providerItemId,
      rawProviderItem: toolCall.rawProviderItem,
    })),
  ];
}

function updateExistingConversation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
  input: AppendConversationModelCallInput,
  now: Date,
) {
  tx.update(conversation)
    .set({
      previousResponseId: input.responseId ?? input.previousResponseId,
      updatedAt: now,
    })
    .where(eq(conversation.id, conversationId))
    .run();

  return conversationId;
}

function createConversation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: AppendConversationModelCallInput,
  now: Date,
) {
  const conversationInput: ConversationInsert = {
    ...(input.conversationId === undefined ? {} : { id: input.conversationId }),
    providerKey: input.providerKey,
    previousResponseId: input.responseId ?? input.previousResponseId,
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

function getOrCreateState(conversationId: number, providerKey: string) {
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
          providerKey,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return selectState(tx, conversationId, providerKey);
  });
}

function selectState(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  conversationId: number,
  providerKey: string,
): ConversationState {
  const conversationRecord = tx
    .select()
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .get();

  if (!conversationRecord) {
    throw new Error(`Conversation '${conversationId}' was not found`);
  }

  if (conversationRecord.providerKey !== providerKey) {
    throw new Error(
      `Conversation '${conversationId}' belongs to provider '${conversationRecord.providerKey}', not '${providerKey}'`,
    );
  }

  const items = tx
    .select()
    .from(conversationItem)
    .where(eq(conversationItem.conversationId, conversationId))
    .orderBy(asc(conversationItem.sequence))
    .all();

  return {
    conversationId,
    previousResponseId: conversationRecord.previousResponseId ?? undefined,
    items,
  };
}
