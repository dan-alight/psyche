import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";

import type { ConversationItem } from "@/db/schema";
import { ChatCompletionsClient } from "@/modelClients/ChatCompletionsClient";
import type { ConversationState, ConversationStore } from "@/modelClients/conversationStore";
import { ResponsesClient } from "@/modelClients/ResponsesClient";
import type { ModelCallRequest, ModelStreamEvent } from "@/modelClients/types";

describe("model clients", () => {
  it("streams chat completions with provided chat history", async () => {
    const store = createMemoryConversationStore({
      conversationId: 7,
      previousResponseId: "resp_old",
      items: [conversationItem({ kind: "message", role: "user", content: "Earlier message" })]
    });
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));

      return new Response(sse([
        { id: "chatcmpl_1", choices: [{ delta: { content: "Hel" } }] },
        { id: "chatcmpl_1", choices: [{ delta: { content: "lo" } }] },
        { id: "chatcmpl_1", choices: [], usage: { output_tokens: 1 } },
        "[DONE]"
      ]), { status: 200 });
    });
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    const events = await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Current message" }]
    })));

    expect(requestBody?.messages).toEqual([
      { role: "user", content: "Earlier message" },
      { role: "user", content: "Current message" }
    ]);
    expect(events).toEqual([
      { type: "response.created", id: "chatcmpl_1" },
      { type: "text.delta", delta: "Hel" },
      { type: "text.delta", delta: "lo" },
      { type: "response.completed", id: "chatcmpl_1", outputText: "Hello", usage: { output_tokens: 1 } }
    ]);
  });

  it("projects stored function call items into chat completion messages", async () => {
    const store = createMemoryConversationStore({
      conversationId: 8,
      previousResponseId: "resp_tool",
      items: [
        conversationItem({ kind: "message", role: "user", content: "What is the weather?", modelCallId: 1 }),
        conversationItem({ kind: "message", role: "assistant", content: "I'll check.", modelCallId: 2 }),
        conversationItem({
          kind: "function_call",
          toolCallId: "call_1",
          toolName: "get_weather",
          toolArguments: "{\"city\":\"Sydney\"}",
          modelCallId: 2
        }),
        conversationItem({ kind: "function_call_output", toolCallId: "call_1", toolOutput: "{\"temp\":22}", modelCallId: 3 })
      ]
    });
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(sse([
        { id: "chatcmpl_2", choices: [{ delta: { content: "It is 22C." } }] },
        "[DONE]"
      ]), { status: 200 });
    });
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Thanks" }]
    })));

    expect(requestBody?.messages).toEqual([
      { role: "user", content: "What is the weather?" },
      {
        role: "assistant",
        content: "I'll check.",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: {
            name: "get_weather",
            arguments: "{\"city\":\"Sydney\"}"
          }
        }]
      },
      { role: "tool", tool_call_id: "call_1", content: "{\"temp\":22}" },
      { role: "user", content: "Thanks" }
    ]);
  });

  it("accepts function call continuation items for chat completions", async () => {
    const store = createMemoryConversationStore({
      conversationId: 10,
      items: []
    });
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(sse([
        { id: "chatcmpl_continue", choices: [{ delta: { content: "Continued" } }] },
        "[DONE]"
      ]), { status: 200 });
    });
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [
        {
          type: "function_call",
          callId: "call_continue",
          name: "get_weather",
          arguments: "{\"city\":\"Sydney\"}"
        },
        { type: "function_call_output", callId: "call_continue", output: "{\"temp\":22}" },
        { type: "message", role: "user", content: "Summarize that." }
      ]
    })));

    expect(requestBody?.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_continue",
          type: "function",
          function: {
            name: "get_weather",
            arguments: "{\"city\":\"Sydney\"}"
          }
        }]
      },
      { role: "tool", tool_call_id: "call_continue", content: "{\"temp\":22}" },
      { role: "user", content: "Summarize that." }
    ]);
  });

  it("projects tool definitions into chat completions requests", async () => {
    const store = createMemoryConversationStore({
      conversationId: 9,
      items: []
    });
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));

      return new Response(sse([
      { id: "chatcmpl_tools", choices: [{ delta: { content: "Done" } }] },
      "[DONE]"
      ]), { status: 200 });
    });
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Use tool if needed" }],
      tools: [{
        type: "function",
        name: "get_weather",
        description: "Gets weather",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        strict: true
      }]
    })));

    expect(requestBody?.tools).toEqual([{
      type: "function",
      function: {
        name: "get_weather",
        description: "Gets weather",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        strict: true
      }
    }]);
  });

  it("throws when the chat completions stream closes before done", async () => {
    const store = createMemoryConversationStore({
      conversationId: 22,
      items: []
    });
    const fetchImpl = vi.fn(async () => new Response(sse([
      { id: "chatcmpl_partial", choices: [{ delta: { content: "Partial" } }] }
    ]), { status: 200 }));
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    await expect(collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }]
    })))).rejects.toThrow("Chat completions stream closed before [DONE]");
  });

  it("throws when a chat completions stream event is invalid JSON", async () => {
    const store = createMemoryConversationStore({
      conversationId: 23,
      items: []
    });
    const fetchImpl = vi.fn(async () => new Response(rawSse(["not-json"]), { status: 200 }));
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    await expect(collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }]
    })))).rejects.toThrow("Failed to parse chat completions stream event");
  });

  it("streams chat completions with a prepared new-conversation request", async () => {
    const store = createMemoryConversationStore({
      conversationId: 21,
      items: []
    });
    const fetchImpl = vi.fn(async () => new Response(sse([
      { id: "chatcmpl_new", choices: [{ delta: { content: "Created" } }] },
      "[DONE]"
    ]), { status: 200 }));
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://example.com/v1",
      fetchImpl
    });

    const events = await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }]
    })));

    expect(events).toEqual([
      { type: "response.created", id: "chatcmpl_new" },
      { type: "text.delta", delta: "Created" },
      { type: "response.completed", id: "chatcmpl_new", outputText: "Created", usage: undefined }
    ]);
  });

  it("streams responses over websocket using previous_response_id", async () => {
    const store = createMemoryConversationStore({
      conversationId: 11,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new FakeWebSocket([
      { type: "response.created", response: { id: "resp_next" } },
      { type: "response.output_text.delta", delta: "Done" },
      { type: "response.completed", response: { id: "resp_next", output_text: "Done", usage: { output_tokens: 2 } } }
    ]);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory: () => socket as unknown as WebSocket
    });

    const events = await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Continue" }]
    })));
    const sent = JSON.parse(socket.sent[0] ?? "{}");

    expect(sent).toMatchObject({
      type: "response.create",
      model: "test-model",
      previous_response_id: "resp_previous",
      store: true
    });
    expect(sent.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Continue" }]
      }
    ]);
    expect(events).toEqual([
      { type: "response.created", id: "resp_next" },
      { type: "text.delta", delta: "Done" },
      { type: "response.completed", id: "resp_next", outputText: "Done", usage: { output_tokens: 2 } }
    ]);
    expect(socket.closeCount).toBe(0);
  });

  it("reuses an open responses websocket for sequential turns", async () => {
    const store = createMemoryConversationStore({
      conversationId: 16,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new FakeWebSocket([
      [
        { type: "response.created", response: { id: "resp_first" } },
        { type: "response.output_text.delta", delta: "First" },
        { type: "response.completed", response: { id: "resp_first", output_text: "First" } }
      ],
      [
        { type: "response.created", response: { id: "resp_second" } },
        { type: "response.output_text.delta", delta: "Second" },
        { type: "response.completed", response: { id: "resp_second", output_text: "Second" } }
      ]
    ]);
    const webSocketFactory = vi.fn(() => socket as unknown as WebSocket);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory
    });

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "First turn" }]
    })));
    store.setPreviousResponseId("resp_first");

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Second turn" }]
    })));

    const firstSent = JSON.parse(socket.sent[0] ?? "{}");
    const secondSent = JSON.parse(socket.sent[1] ?? "{}");

    expect(webSocketFactory).toHaveBeenCalledOnce();
    expect(socket.closeCount).toBe(0);
    expect(firstSent.previous_response_id).toBe("resp_previous");
    expect(secondSent.previous_response_id).toBe("resp_first");

    client.close();
    expect(socket.closeCount).toBe(1);
  });

  it("accepts function call continuation items for responses", async () => {
    const store = createMemoryConversationStore({
      conversationId: 12,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new FakeWebSocket([
      { type: "response.created", response: { id: "resp_after_tool" } },
      { type: "response.output_text.delta", delta: "Tool result handled" },
      { type: "response.completed", response: { id: "resp_after_tool", output_text: "Tool result handled" } }
    ]);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory: () => socket as unknown as WebSocket
    });

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [
        {
          type: "function_call",
          callId: "call_continue",
          name: "get_weather",
          arguments: "{\"city\":\"Sydney\"}",
          providerItemId: "fc_1"
        },
        { type: "function_call_output", callId: "call_continue", output: "{\"temp\":22}" }
      ]
    })));
    const sent = JSON.parse(socket.sent[0] ?? "{}");

    expect(sent.input).toEqual([
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_continue",
        name: "get_weather",
        arguments: "{\"city\":\"Sydney\"}"
      },
      { type: "function_call_output", call_id: "call_continue", output: "{\"temp\":22}" }
    ]);
  });

  it("emits responses tool calls only after function call arguments are finalized", async () => {
    const store = createMemoryConversationStore({
      conversationId: 13,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new FakeWebSocket([
      { type: "response.created", response: { id: "resp_tool" } },
      {
        type: "response.output_item.added",
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "get_weather",
          arguments: "",
          status: "in_progress"
        }
      },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{\"city\"" },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: ":\"Sydney\"}" },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        name: "get_weather",
        arguments: "{\"city\":\"Sydney\"}"
      },
      { type: "response.completed", response: { id: "resp_tool" } }
    ]);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory: () => socket as unknown as WebSocket
    });

    const events = await collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "What is the weather?" }]
    })));

    expect(events).toEqual([
      { type: "response.created", id: "resp_tool" },
      {
        type: "tool_call",
        callId: "call_1",
        name: "get_weather",
        arguments: "{\"city\":\"Sydney\"}",
        providerItemId: "fc_1",
        rawProviderItem: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "get_weather",
          arguments: "{\"city\":\"Sydney\"}",
          status: "in_progress"
        }
      },
      { type: "response.completed", id: "resp_tool", outputText: undefined, usage: undefined }
    ]);
  });

  it("sends full responses input and omits previous response id for store false", async () => {
    const store = createMemoryConversationStore({
      conversationId: 14,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new FakeWebSocket([
      { type: "response.created", response: { id: "resp_zdr" } },
      { type: "response.completed", response: { id: "resp_zdr" } }
    ]);
    const webSocketFactory = vi.fn(() => socket as unknown as WebSocket);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory
    });

    await expect(collect(client.stream(store.modelRequest({
      model: "test-model",
      store: false,
      input: [{ type: "message", role: "user", content: "Continue" }]
    })))).resolves.toEqual([
      { type: "response.created", id: "resp_zdr" },
      { type: "response.completed", id: "resp_zdr", outputText: undefined, usage: undefined }
    ]);
    const sent = JSON.parse(socket.sent[0] ?? "{}");

    expect(sent.store).toBe(false);
    expect(sent.previous_response_id).toBeUndefined();
  });

  it("includes responses history for store false", async () => {
    const store = createMemoryConversationStore({
      conversationId: 24,
      previousResponseId: "resp_missing_from_socket_cache",
      items: [
        conversationItem({
          kind: "message",
          role: "user",
          content: "Earlier",
          modelCallId: 1
        }),
        conversationItem({
          kind: "message",
          role: "assistant",
          content: "Earlier answer",
          modelCallId: 2
        })
      ]
    });
    const socket = new FakeWebSocket([
      { type: "response.created", response: { id: "resp_recovered" } },
      { type: "response.completed", response: { id: "resp_recovered" } }
    ]);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory: () => socket as unknown as WebSocket
    });

    await collect(client.stream(store.modelRequest({
      model: "test-model",
      store: false,
      input: [{ type: "message", role: "user", content: "Follow up" }]
    })));
    const sent = JSON.parse(socket.sent[0] ?? "{}");

    expect(sent.previous_response_id).toBeUndefined();
    expect(sent.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Earlier" }]
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Earlier answer" }]
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Follow up" }]
      }
    ]);
  });

  it("throws responses websocket failures", async () => {
    const store = createMemoryConversationStore({
      conversationId: 15,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new ErroringWebSocket(new Error("socket failed"));
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory: () => socket as unknown as WebSocket
    });

    await expect(collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Continue" }]
    })))).rejects.toThrow("socket failed");
    expect(socket.closeCount).toBe(1);
  });

  it("maps responses websocket auth handshake failures to stream errors", async () => {
    const store = createMemoryConversationStore({
      conversationId: 17,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new UnexpectedResponseWebSocket({
      status: 401,
      statusText: "Unauthorized",
      body: {
        error: {
          code: "invalid_api_key",
          message: "Incorrect API key provided"
        }
      }
    });
    const client = new ResponsesClient({
      auth: { bearerToken: "bad-token" },
      baseUrl: "https://api.openai.com/v1",
      webSocketFactory: () => socket as unknown as WebSocket
    });

    await expect(collect(client.stream(store.modelRequest({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Continue" }]
    })))).resolves.toEqual([
      {
        type: "error",
        status: 401,
        code: "invalid_api_key",
        message: "Incorrect API key provided"
      }
    ]);
    expect(socket.sent).toEqual([]);
    expect(socket.closeCount).toBe(1);
  });
});

function createMemoryConversationStore(initial: ConversationState) {
  const state = { ...initial, items: [...initial.items] };
  const appendedModelCalls: Array<Record<string, unknown>> = [];
  const begunModelCalls: Array<Parameters<ConversationStore["startModelCall"]>[0]> = [];
  const completedModelCalls: Array<Parameters<ConversationStore["completeModelCall"]>[0]> = [];
  const failedModelCalls: Array<Parameters<ConversationStore["failModelCall"]>[0]> = [];
  const abortedModelCalls: Array<Parameters<ConversationStore["abortModelCall"]>[0]> = [];
  const activeModelCalls = new Map<
    number,
    Parameters<ConversationStore["startModelCall"]>[0] & {
      previousResponseId?: string;
    }
  >();
  let nextModelCallId = 1;

  return {
    modelRequest(input: Omit<
      ModelCallRequest,
      "conversationId" | "modelCallId" | "previousResponseId" | "historyItems"
    >): ModelCallRequest {
      return {
        previousResponseId: state.previousResponseId,
        historyItems: [...state.items],
        ...input
      };
    },
    setPreviousResponseId(responseId: string | undefined) {
      state.previousResponseId = responseId;
    },
    appendedModelCalls,
    begunModelCalls,
    completedModelCalls,
    failedModelCalls,
    abortedModelCalls,
    async getState(conversationId: number) {
      return { ...state, conversationId };
    },
    async getMaxTranscriptItemId() {
      return 0;
    },
    async listTranscriptItemsAfterId() {
      return [];
    },
    async listRecentModelCallsWithTranscriptItems() {
      return [];
    },
    async startModelCall(input: Parameters<ConversationStore["startModelCall"]>[0]) {
      const historyItems = [...state.items];
      const modelCallId = nextModelCallId;
      nextModelCallId += 1;

      begunModelCalls.push(input);
      activeModelCalls.set(modelCallId, {
        ...input,
        previousResponseId: state.previousResponseId
      });
      state.items.push(...input.input.map((item) => modelInputConversationItem(item, modelCallId)));

      return {
        conversationId: state.conversationId,
        modelCallId,
        transcriptItems: [],
        requestContext: {
          previousResponseId: state.previousResponseId,
          historyItems,
        },
        lifecycle: {
          createdConversation: false,
          createdModelCall: true,
        },
      };
    },
    async completeModelCall(input: Parameters<ConversationStore["completeModelCall"]>[0]) {
      completedModelCalls.push(input);
      const started = activeModelCalls.get(input.modelCallId);
      appendedModelCalls.push({
        ...started,
        ...input,
        conversationId: input.conversationId,
        previousResponseId: started?.previousResponseId,
        model: started?.model,
        tools: started?.tools,
        input: started?.input,
        functionCalls: input.functionCalls
      });
      state.previousResponseId = input.responseId ?? state.previousResponseId;
      state.conversationId = input.conversationId;
      return { ...state, items: [...state.items], transcriptItems: [] };
    },
    async failModelCall(input: Parameters<ConversationStore["failModelCall"]>[0]) {
      failedModelCalls.push(input);
      state.conversationId = input.conversationId;
      return { ...state, items: [...state.items] };
    },
    async abortModelCall(input: Parameters<ConversationStore["abortModelCall"]>[0]) {
      abortedModelCalls.push(input);
      state.conversationId = input.conversationId;
      return { ...state, items: [...state.items] };
    },
    async abortRunningModelCalls() {
      return 0;
    }
  } satisfies ConversationStore & {
    modelRequest(input: Omit<
      ModelCallRequest,
      "conversationId" | "modelCallId" | "previousResponseId" | "historyItems"
    >): ModelCallRequest;
    setPreviousResponseId(responseId: string | undefined): void;
    appendedModelCalls: Array<Record<string, unknown>>;
    begunModelCalls: Array<Parameters<ConversationStore["startModelCall"]>[0]>;
    completedModelCalls: Array<Parameters<ConversationStore["completeModelCall"]>[0]>;
    failedModelCalls: Array<Parameters<ConversationStore["failModelCall"]>[0]>;
    abortedModelCalls: Array<Parameters<ConversationStore["abortModelCall"]>[0]>;
  };
}

let nextConversationItemId = 1;

function modelInputConversationItem(
  input: Parameters<ConversationStore["startModelCall"]>[0]["input"][number],
  modelCallId: number,
) {
  if (input.type === "function_call_output") {
    return conversationItem({
      kind: "function_call_output",
      toolCallId: input.callId,
      toolOutput: input.output,
      modelCallId
    });
  }

  if (input.type === "function_call") {
    return conversationItem({
      kind: "function_call",
      toolCallId: input.callId,
      toolName: input.name,
      toolArguments: input.arguments,
      providerItemId: input.providerItemId,
      rawProviderItem: input.rawProviderItem,
      modelCallId
    });
  }

  if (input.type === "reasoning") {
    return conversationItem({
      kind: "reasoning",
      providerItemId: input.providerItemId,
      rawProviderItem: input.rawProviderItem,
      modelCallId
    });
  }

  return conversationItem({
    kind: "message",
    role: input.role,
    content: input.content,
    modelCallId
  });
}

function conversationItem(input: {
  kind: ConversationItem["kind"];
  role?: ConversationItem["role"];
  content?: string;
  modelCallId?: number;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: string;
  toolOutput?: string;
  providerItemId?: string;
  rawProviderItem?: Record<string, unknown>;
}): ConversationItem {
  const id = nextConversationItemId;
  nextConversationItemId += 1;

  return {
    id,
    conversationId: 0,
    modelCallId: input.modelCallId ?? null,
    sequence: id,
    kind: input.kind,
    role: input.role ?? null,
    content: input.content ?? null,
    toolCallId: input.toolCallId ?? null,
    toolName: input.toolName ?? null,
    toolArguments: input.toolArguments ?? null,
    toolOutput: input.toolOutput ?? null,
    providerItemId: input.providerItemId ?? null,
    rawProviderItem: input.rawProviderItem ?? null,
    createdAt: new Date(0)
  };
}

class FakeWebSocket extends EventEmitter {
  readonly sent: string[] = [];
  closeCount = 0;
  readyState = 0;
  private sendCount = 0;

  constructor(private readonly messages: Array<Record<string, unknown>> | Array<Array<Record<string, unknown>>>) {
    super();
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.emit("open");
      }
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
    const messages = Array.isArray(this.messages[0])
      ? (this.messages as Array<Array<Record<string, unknown>>>)[this.sendCount] ?? []
      : this.messages as Array<Record<string, unknown>>;
    this.sendCount += 1;

    setTimeout(() => {
      for (const message of messages) {
        this.emit("message", Buffer.from(JSON.stringify(message)));
      }
    }, 0);
  }

  close() {
    if (this.readyState === 3) {
      return;
    }

    this.closeCount += 1;
    this.readyState = 3;
    this.emit("close");
  }
}

class ErroringWebSocket extends EventEmitter {
  readonly sent: string[] = [];
  closeCount = 0;
  readyState = 0;

  constructor(private readonly error: Error) {
    super();
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this.emit("open");
      }
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
    setTimeout(() => this.emit("error", this.error), 0);
  }

  close() {
    if (this.readyState === 3) {
      return;
    }

    this.closeCount += 1;
    this.readyState = 3;
    this.emit("close");
  }
}

class UnexpectedResponseWebSocket extends EventEmitter {
  readonly sent: string[] = [];
  closeCount = 0;
  readyState = 0;

  constructor(private readonly response: {
    status: number;
    statusText: string;
    body: Record<string, unknown>;
  }) {
    super();
    setTimeout(() => {
      if (this.readyState !== 0) {
        return;
      }

      const body = Readable.from([JSON.stringify(this.response.body)]) as Readable & {
        statusCode?: number;
        statusMessage?: string;
      };
      body.statusCode = this.response.status;
      body.statusMessage = this.response.statusText;
      this.emit("unexpected-response", {}, body);
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === 3) {
      return;
    }

    this.closeCount += 1;
    if (this.readyState === 0) {
      this.emit("error", new Error("WebSocket was closed before the connection was established"));
    }
    this.readyState = 3;
    this.emit("close");
  }
}

async function collect(stream: AsyncIterable<ModelStreamEvent>) {
  const events: ModelStreamEvent[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

function sse(messages: Array<Record<string, unknown> | "[DONE]">) {
  return rawSse(messages.map((message) => message === "[DONE]" ? message : JSON.stringify(message)));
}

function rawSse(messages: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const message of messages) {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      }
      controller.close();
    }
  });
}
