import type {
  ConversationModelCall,
  ConversationTranscriptItem,
} from "@/db/schema";
import {
  createDrizzleConversationStore,
  type AbortModelCallInput,
  type CompleteModelCallInput,
  type ConversationModelCallWithTranscriptItems,
  type ConversationStore,
  type ConversationMutationResult,
  type ConversationState,
  type FailModelCallInput,
  type StartedModelCall,
  type StartModelCallInput,
} from "@/modelClients/conversationStore";

export type ConversationTextDeltaEvent = {
  type: "text_delta";
  liveEventId: number;
  conversationId: number;
  modelCallId: number;
  afterTranscriptItemId: number;
  delta: string;
};

export type ConversationTranscriptItemEvent = {
  type: "transcript_item";
  item: ConversationTranscriptItem;
};

export type ConversationLiveEvent =
  | ConversationTranscriptItemEvent
  | ConversationTextDeltaEvent;

export type ConversationSubscription = AsyncIterable<ConversationLiveEvent> & {
  close(): void;
};

export type RecordTextDeltaInput = {
  conversationId: number;
  modelCallId: number;
  delta: string;
};

export type ConversationManagerOptions = {
  store: ConversationStore;
  initialTranscriptItemId: number;
  maxSubscriberQueueSize?: number;
};

export type CreateConversationManagerOptions = {
  store?: ConversationStore;
  initialTranscriptItemId?: number;
  maxSubscriberQueueSize?: number;
};

const defaultRecentModelCallStatuses: ConversationModelCall["status"][] = [
  "completed",
  "running",
];

export class ConversationManager {
  private readonly store: ConversationStore;
  private readonly maxSubscriberQueueSize: number;
  private readonly subscribers = new Set<ConversationEventQueue>();
  private readonly bufferedTextDeltasByModelCallId = new Map<
    number,
    ConversationTextDeltaEvent[]
  >();
  private mutex: Promise<void> = Promise.resolve();
  private nextLiveEventId = 1;
  private highestKnownTranscriptItemId: number;

  constructor(options: ConversationManagerOptions) {
    this.store = options.store;
    this.maxSubscriberQueueSize = options.maxSubscriberQueueSize ?? 10_000;
    this.highestKnownTranscriptItemId = options.initialTranscriptItemId;
  }

  getState(conversationId: number): Promise<ConversationState> {
    return this.store.getState(conversationId);
  }

  listRecentModelCallsWithTranscriptItems(input: {
    limit: number;
  }): Promise<ConversationModelCallWithTranscriptItems[]> {
    return this.store.listRecentModelCallsWithTranscriptItems({
      limit: input.limit,
      statuses: defaultRecentModelCallStatuses,
    });
  }

  startModelCall(input: StartModelCallInput): Promise<StartedModelCall> {
    return this.runExclusive(async () => {
      const started = await this.store.startModelCall(input);

      this.publishTranscriptItems(started.transcriptItems);

      return started;
    });
  }

  completeModelCall(
    input: CompleteModelCallInput,
  ): Promise<ConversationMutationResult> {
    return this.runExclusive(async () => {
      const result = await this.store.completeModelCall(input);

      this.publishTranscriptItems(result.transcriptItems);
      this.bufferedTextDeltasByModelCallId.delete(input.modelCallId);

      return result;
    });
  }

  failModelCall(input: FailModelCallInput): Promise<ConversationState> {
    return this.runExclusive(async () => {
      const result = await this.store.failModelCall(input);

      this.bufferedTextDeltasByModelCallId.delete(input.modelCallId);

      return result;
    });
  }

  abortModelCall(input: AbortModelCallInput): Promise<ConversationState> {
    return this.runExclusive(async () => {
      const result = await this.store.abortModelCall(input);

      this.bufferedTextDeltasByModelCallId.delete(input.modelCallId);

      return result;
    });
  }

  abortRunningModelCalls(): Promise<number> {
    return this.runExclusive(async () => {
      const aborted = await this.store.abortRunningModelCalls();

      this.bufferedTextDeltasByModelCallId.clear();

      return aborted;
    });
  }

  recordTextDelta(input: RecordTextDeltaInput): Promise<ConversationTextDeltaEvent> {
    return this.runExclusive(() => {
      const event: ConversationTextDeltaEvent = {
        type: "text_delta",
        liveEventId: this.nextLiveEventId++,
        conversationId: input.conversationId,
        modelCallId: input.modelCallId,
        afterTranscriptItemId: this.highestKnownTranscriptItemId,
        delta: input.delta,
      };
      const existing = this.bufferedTextDeltasByModelCallId.get(
        input.modelCallId,
      );

      if (existing) {
        existing.push(event);
      } else {
        this.bufferedTextDeltasByModelCallId.set(input.modelCallId, [event]);
      }

      this.publish(event);

      return event;
    });
  }

  subscribeAfter(input: {
    afterTranscriptItemId: number;
  }): Promise<ConversationSubscription> {
    return this.runExclusive(async () => {
      const queue = new ConversationEventQueue({
        maxQueuedEvents: this.maxSubscriberQueueSize,
        onClose: () => {
          this.subscribers.delete(queue);
        },
      });

      try {
        const transcriptItems = await this.store.listTranscriptItemsAfterId(
          input.afterTranscriptItemId,
        );

        for (const item of transcriptItems) {
          queue.enqueueInitial({
            type: "transcript_item",
            item,
          });
        }

        for (const event of this.snapshotBufferedTextDeltas(
          input.afterTranscriptItemId,
        )) {
          queue.enqueueInitial(event);
        }

        queue.finishInitializing();
        this.subscribers.add(queue);
      } catch (error) {
        queue.close();
        throw error;
      }

      return queue;
    });
  }

  private publishTranscriptItems(items: ConversationTranscriptItem[]) {
    const sortedItems = [...items].sort((first, second) => first.id - second.id);

    this.updateHighestKnownTranscriptItemId(sortedItems);

    for (const item of sortedItems) {
      this.publish({
        type: "transcript_item",
        item,
      });
    }
  }

  private publish(event: ConversationLiveEvent) {
    for (const subscriber of this.subscribers) {
      subscriber.enqueueLive(event);
    }
  }

  private snapshotBufferedTextDeltas(afterTranscriptItemId: number) {
    return [...this.bufferedTextDeltasByModelCallId.values()]
      .flat()
      .filter((event) => event.afterTranscriptItemId >= afterTranscriptItemId)
      .sort((first, second) => first.liveEventId - second.liveEventId);
  }

  private updateHighestKnownTranscriptItemId(items: ConversationTranscriptItem[]) {
    for (const item of items) {
      this.highestKnownTranscriptItemId = Math.max(
        this.highestKnownTranscriptItemId,
        item.id,
      );
    }
  }

  private async runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.mutex;
    let releaseCurrent!: () => void;

    this.mutex = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      releaseCurrent();
    }
  }
}

type ConversationEventQueueOptions = {
  maxQueuedEvents: number;
  onClose: () => void;
};

class ConversationEventQueue
  implements AsyncIterableIterator<ConversationLiveEvent>
{
  private readonly maxQueuedEvents: number;
  private readonly onClose: () => void;
  private readonly readyEvents: ConversationLiveEvent[] = [];
  private readonly pendingLiveEvents: ConversationLiveEvent[] = [];
  private readonly seenTranscriptItemIds = new Set<number>();
  private readonly seenLiveEventIds = new Set<number>();
  private waiting:
    | ((result: IteratorResult<ConversationLiveEvent>) => void)
    | undefined;
  private initializing = true;
  private closed = false;

  constructor(options: ConversationEventQueueOptions) {
    this.maxQueuedEvents = options.maxQueuedEvents;
    this.onClose = options.onClose;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next(): Promise<IteratorResult<ConversationLiveEvent>> {
    const event = this.readyEvents.shift();

    if (event) {
      return Promise.resolve({ done: false, value: event });
    }

    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  enqueueInitial(event: ConversationLiveEvent) {
    this.enqueueReady(event);
  }

  enqueueLive(event: ConversationLiveEvent) {
    if (this.closed) {
      return;
    }

    if (this.initializing) {
      this.pendingLiveEvents.push(event);
      return;
    }

    this.enqueueReady(event);
  }

  finishInitializing() {
    if (this.closed) {
      return;
    }

    this.initializing = false;

    for (const event of this.pendingLiveEvents.splice(0)) {
      this.enqueueReady(event);
    }
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.readyEvents.length = 0;
    this.pendingLiveEvents.length = 0;
    this.onClose();

    if (this.waiting) {
      this.waiting({ done: true, value: undefined });
      this.waiting = undefined;
    }
  }

  private enqueueReady(event: ConversationLiveEvent) {
    if (this.closed || !this.markSeen(event)) {
      return;
    }

    if (this.readyEvents.length >= this.maxQueuedEvents) {
      this.close();
      return;
    }

    if (this.waiting) {
      this.waiting({ done: false, value: event });
      this.waiting = undefined;
      return;
    }

    this.readyEvents.push(event);
  }

  private markSeen(event: ConversationLiveEvent) {
    if (event.type === "transcript_item") {
      if (this.seenTranscriptItemIds.has(event.item.id)) {
        return false;
      }

      this.seenTranscriptItemIds.add(event.item.id);
      return true;
    }

    if (this.seenLiveEventIds.has(event.liveEventId)) {
      return false;
    }

    this.seenLiveEventIds.add(event.liveEventId);
    return true;
  }
}

let globalConversationManager: ConversationManager | undefined;

export async function createConversationManager(
  options: CreateConversationManagerOptions = {},
) {
  const store = options.store ?? createDrizzleConversationStore();
  const initialTranscriptItemId =
    options.initialTranscriptItemId ?? (await store.getMaxTranscriptItemId());

  return new ConversationManager({
    store,
    initialTranscriptItemId,
    maxSubscriberQueueSize: options.maxSubscriberQueueSize,
  });
}

export async function initializeConversationManager(
  options: CreateConversationManagerOptions = {},
) {
  globalConversationManager ??= await createConversationManager(options);

  return globalConversationManager;
}

export function getConversationManager() {
  if (!globalConversationManager) {
    throw new Error("ConversationManager has not been initialized");
  }

  return globalConversationManager;
}
