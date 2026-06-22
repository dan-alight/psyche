import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { WebSocket } from "ws";
import { describe, expect, it } from "vitest";

import { ConversationManager } from "@/conversations/ConversationManager";
import type {
  ConversationModelCall,
  ConversationTranscriptItem,
} from "@/db/schema";
import type {
  ConversationState,
  ConversationStore,
} from "@/modelClients/conversationStore";
import { registerConversationRoutes } from "@/routes/conversation";

describe("conversation routes", () => {
  it("returns recent completed and running model calls with transcript items", async () => {
    const modelCall = conversationModelCall({ id: 7, status: "running" });
    const item = transcriptItem({
      id: 11,
      modelCallId: modelCall.id,
      kind: "user_prompt",
      content: "Hi",
    });
    const store = createStore({
      modelCallsWithTranscriptItems: [
        {
          modelCall,
          transcriptItems: [item],
        },
      ],
    });
    const app = await buildTestApp(
      new ConversationManager({
        store,
        initialTranscriptItemId: 0,
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/conversation/model-calls?limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      modelCalls: [
        {
          modelCall: {
            ...modelCall,
            createdAt: modelCall.createdAt.toISOString(),
            completedAt: null,
          },
          transcriptItems: [
            {
              ...item,
              createdAt: item.createdAt.toISOString(),
            },
          ],
        },
      ],
    });
    expect(store.lastListRecentInput).toEqual({
      limit: 1,
      statuses: ["completed", "running"],
    });

    await app.close();
  });

  it("streams transcript catch-up rows over websocket", async () => {
    const item = transcriptItem({
      id: 11,
      modelCallId: 7,
      kind: "user_prompt",
      content: "Hi",
    });
    const store = createStore({
      transcriptItems: [item],
    });
    const app = await buildTestApp(
      new ConversationManager({
        store,
        initialTranscriptItemId: 0,
      }),
    );
    const messagePromise = createMessagePromise();
    const socket = await app.injectWS(
      "/conversation/stream?afterTranscriptItemId=10",
      {},
      {
        onOpen(socket) {
          messagePromise.listen(socket);
        },
      },
    );

    expect(await messagePromise.value).toEqual({
      type: "transcript_item",
      item: {
        ...item,
        createdAt: item.createdAt.toISOString(),
      },
    });

    socket.terminate();
    await app.close();
  });

});

async function buildTestApp(manager: ConversationManager) {
  const app = Fastify({ logger: false });

  await app.register(websocket);
  await app.register(registerConversationRoutes, { manager });
  await app.ready();

  return app;
}

function createStore(input: {
  transcriptItems?: ConversationTranscriptItem[];
  modelCallsWithTranscriptItems?: Array<{
    modelCall: ConversationModelCall;
    transcriptItems: ConversationTranscriptItem[];
  }>;
} = {}) {
  const state: ConversationState = {
    conversationId: 1,
    items: [],
  };
  const store = {
    lastListRecentInput: undefined as
      | Parameters<ConversationStore["listRecentModelCallsWithTranscriptItems"]>[0]
      | undefined,
    async getState(conversationId: number) {
      return { ...state, conversationId };
    },
    async getMaxTranscriptItemId() {
      return Math.max(0, ...(input.transcriptItems ?? []).map((item) => item.id));
    },
    async listTranscriptItemsAfterId(afterTranscriptItemId: number) {
      return (input.transcriptItems ?? []).filter(
        (item) => item.id > afterTranscriptItemId,
      );
    },
    async listRecentModelCallsWithTranscriptItems(
      listInput: Parameters<
        ConversationStore["listRecentModelCallsWithTranscriptItems"]
      >[0],
    ) {
      store.lastListRecentInput = listInput;
      return input.modelCallsWithTranscriptItems ?? [];
    },
    async startModelCall() {
      return {
        conversationId: 1,
        modelCallId: 1,
        transcriptItems: [],
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
      return {
        ...state,
        conversationId: input.conversationId,
        transcriptItems: [],
      };
    },
    async failModelCall(input: Parameters<ConversationStore["failModelCall"]>[0]) {
      return {
        ...state,
        conversationId: input.conversationId,
      };
    },
    async abortModelCall(input: Parameters<ConversationStore["abortModelCall"]>[0]) {
      return {
        ...state,
        conversationId: input.conversationId,
      };
    },
    async abortRunningModelCalls() {
      return 0;
    },
  } satisfies ConversationStore & {
    lastListRecentInput:
      | Parameters<ConversationStore["listRecentModelCallsWithTranscriptItems"]>[0]
      | undefined;
  };

  return store;
}

function conversationModelCall(input: {
  id: number;
  status: ConversationModelCall["status"];
}): ConversationModelCall {
  return {
    id: input.id,
    conversationId: 1,
    providerKey: "openai",
    model: "gpt-test",
    transport: "responses",
    previousResponseId: null,
    responseId: null,
    status: input.status,
    usage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: null,
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

function createMessagePromise() {
  let listen!: (socket: WebSocket) => void;
  const value = new Promise<unknown>((resolve) => {
    listen = (socket) => {
      socket.once("message", (data) => {
        resolve(JSON.parse(data.toString()));
      });
    };
  });

  return { listen, value };
}
