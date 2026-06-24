import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationStore } from "@/modelClients/conversationStore";

afterEach(() => {
  vi.resetModules();
  delete process.env.DATABASE_URL;
});

describe("createDrizzleConversationStore", () => {
  it("excludes items from failed model calls from the next request history", async () => {
    const store = await createIsolatedStore();
    const firstCall = await store.startModelCall({
      providerKey: "openai",
      model: "gpt-test",
      transport: "responses",
      input: [
        {
          type: "message",
          role: "user",
          content: "This prompt will fail",
        },
      ],
      transcriptUserPrompt: "This prompt will fail",
    });

    await store.failModelCall({
      conversationId: firstCall.conversationId,
      modelCallId: firstCall.modelCallId,
      failure: {
        message: "Provider stream failed",
        code: "stream_error",
        status: 500,
      },
    });

    const stateAfterFailure = await store.getState(firstCall.conversationId);
    expect(stateAfterFailure.items).toMatchObject([
      {
        modelCallId: firstCall.modelCallId,
        kind: "message",
        role: "user",
        content: "This prompt will fail",
      },
    ]);

    const failedCalls = await store.listRecentModelCallsWithTranscriptItems({
      limit: 10,
      statuses: ["failed"],
    });
    expect(failedCalls[0]?.modelCall).toMatchObject({
      id: firstCall.modelCallId,
      status: "failed",
      failureMessage: "Provider stream failed",
      failureCode: "stream_error",
      failureStatus: 500,
    });

    const secondCall = await store.startModelCall({
      providerKey: "openai",
      model: "gpt-test",
      transport: "responses",
      input: [
        {
          type: "message",
          role: "user",
          content: "This prompt should not stack on the failed one",
        },
      ],
      transcriptUserPrompt: "This prompt should not stack on the failed one",
    });

    expect(secondCall.requestContext.historyItems).toEqual([]);
  });

  it("includes items from completed model calls in the next request history", async () => {
    const store = await createIsolatedStore();
    const firstCall = await store.startModelCall({
      providerKey: "openai",
      model: "gpt-test",
      transport: "responses",
      input: [
        {
          type: "message",
          role: "user",
          content: "Hello",
        },
      ],
      transcriptUserPrompt: "Hello",
    });

    await store.completeModelCall({
      conversationId: firstCall.conversationId,
      modelCallId: firstCall.modelCallId,
      responseId: "resp_1",
      outputText: "Hi",
      functionCalls: [],
    });

    const secondCall = await store.startModelCall({
      providerKey: "openai",
      model: "gpt-test",
      transport: "responses",
      input: [
        {
          type: "message",
          role: "user",
          content: "Again",
        },
      ],
      transcriptUserPrompt: "Again",
    });

    expect(secondCall.requestContext.historyItems).toMatchObject([
      {
        modelCallId: firstCall.modelCallId,
        kind: "message",
        role: "user",
        content: "Hello",
      },
      {
        modelCallId: firstCall.modelCallId,
        kind: "message",
        role: "assistant",
        content: "Hi",
      },
    ]);
  });
});

async function createIsolatedStore(): Promise<ConversationStore> {
  process.env.DATABASE_URL = ":memory:";
  vi.resetModules();

  const { migrateDatabase } = await import("@/db/client");
  const { createDrizzleConversationStore } = await import(
    "@/modelClients/conversationStore"
  );

  migrateDatabase();

  return createDrizzleConversationStore();
}
