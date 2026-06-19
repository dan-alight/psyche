import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";

import type { ConversationItem } from "@/db/schema";
import { ChatCompletionsClient } from "@/modelClients/ChatCompletionsClient";
import type { ConversationState, ConversationStore } from "@/modelClients/conversationStore";
import { ResponsesClient } from "@/modelClients/ResponsesClient";
import type { ModelStreamEvent } from "@/modelClients/types";

describe("model clients", () => {
  it("streams chat completions with persisted chat history and records the completed turn", async () => {
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
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    const events = await collect(client.stream({
      conversationId: 7,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Current message" }]
    }));

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
    expect(store.appendedModelCalls[0]).toMatchObject({
      conversationId: 7,
      previousResponseId: "resp_old",
      responseId: "chatcmpl_1",
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Current message" }],
      outputText: "Hello"
    });
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
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    await collect(client.stream({
      conversationId: 8,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Thanks" }]
    }));

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
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    await collect(client.stream({
      conversationId: 10,
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
    }));

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
    expect(store.appendedModelCalls[0]?.input).toEqual([
      {
        type: "function_call",
        callId: "call_continue",
        name: "get_weather",
        arguments: "{\"city\":\"Sydney\"}"
      },
      { type: "function_call_output", callId: "call_continue", output: "{\"temp\":22}" },
      { type: "message", role: "user", content: "Summarize that." }
    ]);
    expect(store.appendedModelCalls[0]?.outputText).toBe("Continued");
  });

  it("stores tool definitions on the completed model call", async () => {
    const store = createMemoryConversationStore({
      conversationId: 9,
      items: []
    });
    const fetchImpl = vi.fn(async () => new Response(sse([
      { id: "chatcmpl_tools", choices: [{ delta: { content: "Done" } }] },
      "[DONE]"
    ]), { status: 200 }));
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    await collect(client.stream({
      conversationId: 9,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Use tool if needed" }],
      tools: [{
        type: "function",
        name: "get_weather",
        description: "Gets weather",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        strict: true
      }]
    }));

    expect(store.appendedModelCalls[0]?.tools).toEqual([{
      type: "function",
      name: "get_weather",
      description: "Gets weather",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      strict: true
    }]);
  });

  it("does not persist chat completions when the stream closes before done", async () => {
    const store = createMemoryConversationStore({
      conversationId: 22,
      items: []
    });
    const fetchImpl = vi.fn(async () => new Response(sse([
      { id: "chatcmpl_partial", choices: [{ delta: { content: "Partial" } }] }
    ]), { status: 200 }));
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    const events = await collect(client.stream({
      conversationId: 22,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }]
    }));

    expect(events).toEqual([
      { type: "response.created", id: "chatcmpl_partial" },
      { type: "text.delta", delta: "Partial" },
      { type: "error", message: "Chat completions stream closed before [DONE]" }
    ]);
    expect(store.appendedModelCalls).toEqual([]);
  });

  it("does not persist chat completions when a stream event is invalid JSON", async () => {
    const store = createMemoryConversationStore({
      conversationId: 23,
      items: []
    });
    const fetchImpl = vi.fn(async () => new Response(rawSse(["not-json"]), { status: 200 }));
    const client = new ChatCompletionsClient({
      auth: { bearerToken: "token" },
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    const events = await collect(client.stream({
      conversationId: 23,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }]
    }));

    expect(events).toEqual([
      { type: "error", message: "Failed to parse chat completions stream event" }
    ]);
    expect(store.appendedModelCalls).toEqual([]);
  });

  it("creates a conversation when streaming without a conversation id", async () => {
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
      providerKey: "openai-compatible",
      baseUrl: "https://example.com/v1",
      conversationStore: store,
      fetchImpl
    });

    const events = await collect(client.stream({
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }]
    }));

    expect(events).toEqual([
      { type: "response.created", id: "chatcmpl_new" },
      { type: "text.delta", delta: "Created" },
      { type: "conversation.created", conversationId: 21 },
      { type: "response.completed", id: "chatcmpl_new", outputText: "Created", usage: undefined }
    ]);
    expect(store.appendedModelCalls[0]).toMatchObject({
      conversationId: undefined,
      previousResponseId: undefined,
      responseId: "chatcmpl_new",
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Start" }],
      outputText: "Created"
    });
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
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      conversationStore: store,
      webSocketFactory: () => socket as unknown as WebSocket
    });

    const events = await collect(client.stream({
      conversationId: 11,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Continue" }]
    }));
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
    expect(store.appendedModelCalls[0]).toMatchObject({
      conversationId: 11,
      previousResponseId: "resp_previous",
      responseId: "resp_next",
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Continue" }],
      outputText: "Done"
    });
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
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      conversationStore: store,
      webSocketFactory
    });

    await collect(client.stream({
      conversationId: 16,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "First turn" }]
    }));
    await collect(client.stream({
      conversationId: 16,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Second turn" }]
    }));

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
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      conversationStore: store,
      webSocketFactory: () => socket as unknown as WebSocket
    });

    await collect(client.stream({
      conversationId: 12,
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
    }));
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
    expect(store.appendedModelCalls[0]?.input).toEqual([
      {
        type: "function_call",
        callId: "call_continue",
        name: "get_weather",
        arguments: "{\"city\":\"Sydney\"}",
        providerItemId: "fc_1"
      },
      { type: "function_call_output", callId: "call_continue", output: "{\"temp\":22}" }
    ]);
    expect(store.appendedModelCalls[0]?.outputText).toBe("Tool result handled");
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
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      conversationStore: store,
      webSocketFactory: () => socket as unknown as WebSocket
    });

    const events = await collect(client.stream({
      conversationId: 13,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "What is the weather?" }]
    }));

    expect(events).toEqual([
      { type: "response.created", id: "resp_tool" },
      {
        type: "tool_call",
        callId: "call_1",
        name: "get_weather",
        arguments: "{\"city\":\"Sydney\"}"
      },
      { type: "response.completed", id: "resp_tool", outputText: undefined, usage: undefined }
    ]);
    expect(store.appendedModelCalls[0]?.functionCalls).toEqual([{
      type: "function_call",
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
    }]);
  });

  it("rejects store false for responses conversations", async () => {
    const store = createMemoryConversationStore({
      conversationId: 14,
      previousResponseId: "resp_previous",
      items: []
    });
    const webSocketFactory = vi.fn(() => new FakeWebSocket([]) as unknown as WebSocket);
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      conversationStore: store,
      webSocketFactory
    });

    const events = await collect(client.stream({
      conversationId: 14,
      model: "test-model",
      store: false,
      input: [{ type: "message", role: "user", content: "Continue" }]
    }));

    expect(events).toEqual([{
      type: "error",
      message: "Responses conversations require store=true for resumable previous_response_id continuity"
    }]);
    expect(webSocketFactory).not.toHaveBeenCalled();
    expect(store.appendedModelCalls).toEqual([]);
  });

  it("normalizes responses websocket failures into error events", async () => {
    const store = createMemoryConversationStore({
      conversationId: 15,
      previousResponseId: "resp_previous",
      items: []
    });
    const socket = new ErroringWebSocket(new Error("socket failed"));
    const client = new ResponsesClient({
      auth: { bearerToken: "token" },
      providerKey: "openai",
      baseUrl: "https://api.openai.com/v1",
      conversationStore: store,
      webSocketFactory: () => socket as unknown as WebSocket
    });

    const events = await collect(client.stream({
      conversationId: 15,
      model: "test-model",
      input: [{ type: "message", role: "user", content: "Continue" }]
    }));

    expect(events).toEqual([{ type: "error", message: "socket failed" }]);
    expect(store.appendedModelCalls).toEqual([]);
    expect(socket.closeCount).toBe(1);
  });
});

function createMemoryConversationStore(initial: ConversationState) {
  const state = { ...initial };
  const appendedModelCalls: Array<Parameters<ConversationStore["appendModelCall"]>[0]> = [];

  return {
    appendedModelCalls,
    async getState(conversationId: number, _providerKey: string) {
      return { ...state, conversationId };
    },
    async appendModelCall(input: Parameters<ConversationStore["appendModelCall"]>[0]) {
      appendedModelCalls.push(input);
      state.previousResponseId = input.responseId ?? input.previousResponseId;
      state.conversationId = input.conversationId ?? state.conversationId;
      return { ...state };
    }
  } satisfies ConversationStore & {
    appendedModelCalls: Array<Parameters<ConversationStore["appendModelCall"]>[0]>;
  };
}

let nextConversationItemId = 1;

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
  providerResponseId?: string;
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
    providerResponseId: input.providerResponseId ?? null,
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
