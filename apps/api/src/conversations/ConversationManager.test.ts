import { describe, expect, it, vi } from "vitest";

import {
  ConversationManager,
  createConversationManager,
  type ConversationSubscription,
} from "@/conversations/ConversationManager";
import type {
  ConversationModelCall,
  ConversationTranscriptItem,
} from "@/db/schema";
import type {
  ConversationState,
  ConversationStore,
} from "@/modelClients/conversationStore";

describe("ConversationManager", () => {
  it("publishes created model calls before their transcript items", async () => {
    const userPrompt = transcriptItem({
      id: 2,
      modelCallId: 10,
      kind: "user_prompt",
      content: "Hi",
    });
    const context = createStore({
      startTranscriptItems: [userPrompt],
    });
    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 0,
    });
    const subscription = await manager.subscribeAfter({
      afterTranscriptItemId: 0,
    });

    await manager.startModelCall(modelCallInput());

    expect(await readNext(subscription)).toEqual({
      type: "model_call_updated",
      liveEventId: 1,
      modelCall: expect.objectContaining({
        id: 10,
        conversationId: 1,
        status: "running",
      }),
    });
    expect(await readNext(subscription)).toEqual({
      type: "transcript_item",
      item: userPrompt,
    });

    subscription.close();
  });

  it("backfills transcript items and live deltas for mid-stream subscribers", async () => {
    const userPrompt = transcriptItem({
      id: 2,
      modelCallId: 10,
      kind: "user_prompt",
      content: "Hi",
    });
    const context = createStore({
      startTranscriptItems: [userPrompt],
    });
    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 0,
    });

    await manager.startModelCall(modelCallInput());
    await manager.recordTextDelta({
      conversationId: 1,
      modelCallId: 10,
      delta: "Hel",
    });

    const subscription = await manager.subscribeAfter({
      afterTranscriptItemId: 1,
    });

    expect(await readNext(subscription)).toEqual({
      type: "transcript_item",
      item: userPrompt,
    });
    expect(await readNext(subscription)).toEqual({
      type: "text_delta",
      liveEventId: 2,
      conversationId: 1,
      modelCallId: 10,
      afterTranscriptItemId: 2,
      delta: "Hel",
    });

    subscription.close();
  });

  it("drops buffered deltas after the completed assistant transcript item is available", async () => {
    const userPrompt = transcriptItem({
      id: 2,
      modelCallId: 10,
      kind: "user_prompt",
      content: "Hi",
    });
    const assistantOutput = transcriptItem({
      id: 3,
      modelCallId: 10,
      kind: "assistant_output",
      content: "Hello",
    });
    const context = createStore({
      startTranscriptItems: [userPrompt],
      completeTranscriptItems: [assistantOutput],
    });
    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 0,
    });

    await manager.startModelCall(modelCallInput());
    await manager.recordTextDelta({
      conversationId: 1,
      modelCallId: 10,
      delta: "Hel",
    });
    await manager.completeModelCall({
      conversationId: 1,
      modelCallId: 10,
      responseId: "resp_1",
      outputText: "Hello",
      functionCalls: [],
    });

    const subscription = await manager.subscribeAfter({
      afterTranscriptItemId: 2,
    });

    expect(await readNext(subscription)).toEqual({
      type: "transcript_item",
      item: assistantOutput,
    });
    expect(await hasImmediateEvent(subscription)).toBe(false);

    subscription.close();
  });

  it("publishes failed model call updates over active subscriptions", async () => {
    const context = createStore();
    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 0,
    });
    const subscription = await manager.subscribeAfter({
      afterTranscriptItemId: 0,
    });

    await manager.failModelCall({
      conversationId: 1,
      modelCallId: 10,
      failure: {
        message: "Model overloaded",
        code: "overloaded",
        status: 503,
      },
    });

    expect(await readNext(subscription)).toEqual({
      type: "model_call_updated",
      liveEventId: 1,
      modelCall: expect.objectContaining({
        id: 10,
        conversationId: 1,
        status: "failed",
        failureMessage: "Model overloaded",
        failureCode: "overloaded",
        failureStatus: 503,
      }),
      error: {
        message: "Model overloaded",
        code: "overloaded",
        status: 503,
      },
    });

    subscription.close();
  });

  it("does not replay buffered deltas older than the requested transcript cursor", async () => {
    const userPrompt = transcriptItem({
      id: 2,
      modelCallId: 10,
      kind: "user_prompt",
      content: "Hi",
    });
    const context = createStore({
      startTranscriptItems: [userPrompt],
    });
    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 0,
    });

    await manager.startModelCall(modelCallInput());
    await manager.recordTextDelta({
      conversationId: 1,
      modelCallId: 10,
      delta: "old",
    });

    const subscription = await manager.subscribeAfter({
      afterTranscriptItemId: 3,
    });

    expect(await hasImmediateEvent(subscription)).toBe(false);

    subscription.close();
  });

  it("initializes the live delta watermark from the store max transcript item id", async () => {
    const context = createStore({
      maxTranscriptItemId: 9,
    });
    const manager = await createConversationManager({
      store: context.store,
    });

    const event = await manager.recordTextDelta({
      conversationId: 1,
      modelCallId: 10,
      delta: "after existing rows",
    });

    expect(event.afterTranscriptItemId).toBe(9);
    expect(context.getMaxTranscriptItemId).toHaveBeenCalledOnce();
  });

  it("does not update the live delta watermark from subscription catch-up rows", async () => {
    const catchUpItem = transcriptItem({
      id: 8,
      modelCallId: 10,
      kind: "user_prompt",
      content: "Existing prompt",
    });
    const context = createStore({
      maxTranscriptItemId: 2,
      transcriptItems: [catchUpItem],
    });
    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 2,
    });
    const subscription = await manager.subscribeAfter({
      afterTranscriptItemId: 2,
    });

    expect(await readNext(subscription)).toEqual({
      type: "transcript_item",
      item: catchUpItem,
    });

    const event = await manager.recordTextDelta({
      conversationId: 1,
      modelCallId: 10,
      delta: "still after initialized max",
    });

    expect(event.afterTranscriptItemId).toBe(2);

    subscription.close();
  });

  it("does not interleave live deltas ahead of initial catch-up rows", async () => {
    const deferredTranscriptItems = createDeferred<ConversationTranscriptItem[]>();
    const catchUpItem = transcriptItem({
      id: 4,
      modelCallId: 10,
      kind: "user_prompt",
      content: "Late prompt",
    });
    const context = createStore({
      maxTranscriptItemId: 4,
    });

    context.store.listTranscriptItemsAfterId = vi.fn(
      () => deferredTranscriptItems.promise,
    );

    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 4,
    });
    const subscriptionPromise = manager.subscribeAfter({
      afterTranscriptItemId: 3,
    });
    const deltaPromise = manager.recordTextDelta({
      conversationId: 1,
      modelCallId: 10,
      delta: "queued",
    });

    deferredTranscriptItems.resolve([catchUpItem]);

    const subscription = await subscriptionPromise;
    await deltaPromise;

    expect(await readNext(subscription)).toEqual({
      type: "transcript_item",
      item: catchUpItem,
    });
    expect(await readNext(subscription)).toEqual({
      type: "text_delta",
      liveEventId: 1,
      conversationId: 1,
      modelCallId: 10,
      afterTranscriptItemId: 4,
      delta: "queued",
    });

    subscription.close();
  });

  it("does not register live subscribers until catch-up initialization finishes", async () => {
    const deferredTranscriptItems = createDeferred<ConversationTranscriptItem[]>();
    const context = createStore();

    context.store.listTranscriptItemsAfterId = vi.fn(
      () => deferredTranscriptItems.promise,
    );

    const manager = new ConversationManager({
      store: context.store,
      initialTranscriptItemId: 0,
    });
    const subscriptionPromise = manager.subscribeAfter({
      afterTranscriptItemId: 0,
    });

    await Promise.resolve();

    expect(context.store.listTranscriptItemsAfterId).toHaveBeenCalledOnce();
    expect(getSubscriberCount(manager)).toBe(0);

    deferredTranscriptItems.resolve([]);

    const subscription = await subscriptionPromise;

    expect(getSubscriberCount(manager)).toBe(1);

    subscription.close();

    expect(getSubscriberCount(manager)).toBe(0);
  });
});

function createStore(input: {
  maxTranscriptItemId?: number;
  transcriptItems?: ConversationTranscriptItem[];
  startTranscriptItems?: ConversationTranscriptItem[];
  completeTranscriptItems?: ConversationTranscriptItem[];
} = {}) {
  const state: ConversationState = {
    conversationId: 1,
    items: [],
  };
  const transcriptItems: ConversationTranscriptItem[] = [
    ...(input.transcriptItems ?? []),
  ];
  const startTranscriptItems = input.startTranscriptItems ?? [];
  const completeTranscriptItems = input.completeTranscriptItems ?? [];
  const getMaxTranscriptItemId = vi.fn(async () => {
    return (
      input.maxTranscriptItemId ??
      Math.max(0, ...transcriptItems.map((item) => item.id))
    );
  });

  const store = {
    async getState(conversationId: number) {
      return { ...state, conversationId };
    },
    getMaxTranscriptItemId,
    async listTranscriptItemsAfterId(afterTranscriptItemId: number) {
      return transcriptItems.filter((item) => item.id > afterTranscriptItemId);
    },
    async listRecentModelCallsWithTranscriptItems() {
      return [];
    },
    async startModelCall() {
      transcriptItems.push(...startTranscriptItems);

      return {
        conversationId: 1,
        modelCallId: 10,
        modelCall: modelCall({
          id: 10,
          conversationId: 1,
          status: "running",
        }),
        transcriptItems: startTranscriptItems,
        requestContext: {
          historyItems: [],
        },
        lifecycle: {
          createdConversation: false,
          createdModelCall: true,
        },
      };
    },
    async completeModelCall(input: Parameters<ConversationStore["completeModelCall"]>[0]) {
      transcriptItems.push(...completeTranscriptItems);

      return {
        ...state,
        conversationId: input.conversationId,
        modelCall: modelCall({
          id: input.modelCallId,
          conversationId: input.conversationId,
          status: "completed",
          responseId: input.responseId ?? null,
        }),
        transcriptItems: completeTranscriptItems,
      };
    },
    async failModelCall(input: Parameters<ConversationStore["failModelCall"]>[0]) {
      return {
        ...state,
        conversationId: input.conversationId,
        modelCall: modelCall({
          id: input.modelCallId,
          conversationId: input.conversationId,
          status: "failed",
          responseId: input.responseId ?? null,
          failureMessage: input.failure?.message ?? null,
          failureCode: input.failure?.code ?? null,
          failureStatus: input.failure?.status ?? null,
        }),
      };
    },
    async abortModelCall(input: Parameters<ConversationStore["abortModelCall"]>[0]) {
      return {
        ...state,
        conversationId: input.conversationId,
        modelCall: modelCall({
          id: input.modelCallId,
          conversationId: input.conversationId,
          status: "aborted",
        }),
      };
    },
    async abortRunningModelCalls() {
      return 0;
    },
  } satisfies ConversationStore;

  return { store, transcriptItems, getMaxTranscriptItemId };
}

function modelCall(
  input: Partial<ConversationModelCall> & Pick<ConversationModelCall, "id">,
): ConversationModelCall {
  return {
    id: input.id,
    conversationId: input.conversationId ?? 1,
    providerKey: "openai",
    model: "gpt-test",
    transport: "responses",
    previousResponseId: null,
    responseId: input.responseId ?? null,
    status: input.status ?? "running",
    failureMessage: input.failureMessage ?? null,
    failureCode: input.failureCode ?? null,
    failureStatus: input.failureStatus ?? null,
    usage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: input.completedAt ?? null,
  };
}

function modelCallInput(): Parameters<ConversationStore["startModelCall"]>[0] {
  return {
    providerKey: "openai",
    model: "gpt-test",
    transport: "responses",
    input: [{ type: "message", role: "user", content: "Hi" }],
    transcriptUserPrompt: "Hi",
  };
}

function transcriptItem(input: {
  id: number;
  modelCallId: number;
  kind: ConversationTranscriptItem["kind"];
  content?: string;
}): ConversationTranscriptItem {
  return {
    id: input.id,
    conversationId: 1,
    modelCallId: input.modelCallId,
    sequence: input.id - 1,
    kind: input.kind,
    content: input.content ?? null,
    toolCallId: null,
    toolName: null,
    toolArguments: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

async function readNext(subscription: ConversationSubscription) {
  const result = await subscription[Symbol.asyncIterator]().next();

  if (result.done) {
    throw new Error("Subscription ended before yielding an event");
  }

  return result.value;
}

async function hasImmediateEvent(subscription: ConversationSubscription) {
  const iterator = subscription[Symbol.asyncIterator]();
  const nextEvent = iterator.next().then((result) => !result.done);
  const noEvent = new Promise<false>((resolve) => {
    setTimeout(() => resolve(false), 0);
  });

  return Promise.race([nextEvent, noEvent]);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function getSubscriberCount(manager: ConversationManager) {
  return (
    manager as unknown as {
      subscribers: Set<unknown>;
    }
  ).subscribers.size;
}
