import WebSocket from "ws";

import {
  completeConversationTurn,
  getConversationState,
  isRecord,
  normalizeBaseUrl,
  parseJsonRecord,
  providerHeaders,
} from "@/modelClients/clientUtils";
import {
  createDrizzleConversationStore,
  type ConversationState,
  type ConversationStore,
} from "@/modelClients/conversationStore";
import { toResponsesCreateEvent } from "@/modelClients/requestMapping";
import type {
  ModelCallRequest,
  ModelClient,
  ModelStreamEvent,
  ProviderAuth,
} from "@/modelClients/types";

export type ResponsesClientOptions = {
  auth: ProviderAuth;
  providerKey: string;
  baseUrl: string;
  conversationStore?: ConversationStore;
  webSocketFactory?: (
    url: URL,
    options: { headers: Record<string, string> },
  ) => WebSocket;
};

export class ResponsesClient implements ModelClient {
  private readonly conversationStore: ConversationStore;
  private readonly conversationState = new Map<number, ConversationState>();
  private socket?: WebSocket;
  private inFlight = false;

  constructor(private readonly options: ResponsesClientOptions) {
    this.conversationStore =
      options.conversationStore ?? createDrizzleConversationStore();
  }

  async *stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent> {
    if (request.store === false) {
      yield {
        type: "error",
        message:
          "Responses conversations require store=true for resumable previous_response_id continuity",
      };
      return;
    }

    if (this.inFlight) {
      yield {
        type: "error",
        message: "Responses websocket already has an in-flight response",
      };
      return;
    }

    this.inFlight = true;

    let responseId: string | undefined;
    let outputText = "";
    let usage: unknown;
    const toolCalls = new Map<string, PendingResponsesToolCall>();

    try {
      const conversationState = await getConversationState(
        this.conversationState,
        this.conversationStore,
        request,
        this.options.providerKey,
      );
      const socket = await this.ensureSocket(request.signal);
      const responseCreateEvent = {
        ...toResponsesCreateEvent(request, {
          previousResponseId: conversationState?.previousResponseId,
        }),
        store: request.store ?? true,
      };
      const events = readWebSocketEvents(socket, request.signal);
      socket.send(JSON.stringify(responseCreateEvent));

      for await (const rawEvent of events) {
        const event = parseJsonRecord(rawEvent);

        if (!event) {
          continue;
        }

        for (const streamEvent of toModelStreamEvents(event, toolCalls)) {
          let eventToYield = streamEvent;

          if (streamEvent.type === "response.created") {
            responseId = streamEvent.id;
          }

          if (streamEvent.type === "text.delta") {
            outputText += streamEvent.delta;
          }

          if (streamEvent.type === "response.completed") {
            responseId = streamEvent.id ?? responseId;
            outputText = streamEvent.outputText ?? outputText;
            usage = streamEvent.usage;
            eventToYield = {
              ...streamEvent,
              id: responseId,
              outputText: outputText || undefined,
              usage,
            };

            const updatedConversationState = await completeConversationTurn(
              this.conversationState,
              this.conversationStore,
              this.options.providerKey,
              {
                conversationId: conversationState?.conversationId,
                request,
                responseId,
                outputText,
                toolCalls: completedToolCalls(toolCalls),
                usage,
              },
            );

            if (request.conversationId === undefined) {
              yield {
                type: "conversation.created",
                conversationId: updatedConversationState.conversationId,
              };
            }
          }

          yield eventToYield;

          if (eventToYield.type === "response.completed") {
            return;
          }

          if (eventToYield.type === "error") {
            this.close();
            return;
          }
        }
      }

      this.close();
      yield {
        type: "error",
        message: "Responses websocket closed before response completed",
      };
    } catch (error) {
      this.close();
      yield {
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Responses websocket stream failed",
      };
    } finally {
      this.inFlight = false;
    }
  }

  close() {
    this.socket?.close();
    this.socket = undefined;
  }

  private async ensureSocket(signal: AbortSignal | undefined) {
    if (signal?.aborted) {
      this.close();
      throw new Error("Responses websocket stream was aborted");
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket;
    }

    if (this.socket?.readyState === WebSocket.CONNECTING) {
      await waitForSocketOpen(this.socket, signal);
      return this.socket;
    }

    this.close();

    const socket = (
      this.options.webSocketFactory ??
      ((url, options) => new WebSocket(url, options))
    )(responsesWebSocketUrl(this.options.baseUrl), { headers: this.headers() });

    this.socket = socket;

    try {
      await waitForSocketOpen(socket, signal);
    } catch (error) {
      if (this.socket === socket) {
        this.socket = undefined;
      }
      socket.close();
      throw error;
    }

    return socket;
  }

  private headers() {
    return providerHeaders(this.options.auth);
  }
}

function waitForSocketOpen(socket: WebSocket, signal: AbortSignal | undefined) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (
    socket.readyState === WebSocket.CLOSING ||
    socket.readyState === WebSocket.CLOSED
  ) {
    return Promise.reject(new Error("Responses websocket is closed"));
  }

  if (signal?.aborted) {
    socket.close();
    return Promise.reject(new Error("Responses websocket stream was aborted"));
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Responses websocket closed before opening"));
    };
    const onAbort = () => {
      cleanup();
      socket.close();
      reject(new Error("Responses websocket stream was aborted"));
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (socket.readyState === WebSocket.OPEN) {
      onOpen();
    }
  });
}

function readWebSocketEvents(
  socket: WebSocket,
  signal: AbortSignal | undefined,
): AsyncIterable<string> {
  const queue: Array<string> = [];
  let settled = false;
  let failure: Error | undefined;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };
  const onMessage = (data: WebSocket.RawData) => {
    queue.push(data.toString("utf8"));
    wake();
  };
  const onError = (error: Error) => {
    failure = error;
    settled = true;
    wake();
  };
  const onClose = () => {
    settled = true;
    wake();
  };
  const onAbort = () => {
    settled = true;
    socket.close();
    wake();
  };

  socket.on("message", onMessage);
  socket.once("error", onError);
  socket.once("close", onClose);
  signal?.addEventListener("abort", onAbort, { once: true });

  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (!settled || queue.length > 0) {
          if (queue.length > 0) {
            yield queue.shift()!;
            continue;
          }

          if (failure) {
            throw failure;
          }

          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }

        if (failure) {
          throw failure;
        }
      } finally {
        socket.off("message", onMessage);
        socket.off("error", onError);
        socket.off("close", onClose);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function toModelStreamEvents(
  event: Record<string, unknown>,
  toolCalls: Map<string, PendingResponsesToolCall>,
): ModelStreamEvent[] {
  const type = event.type;

  if (type === "response.created") {
    const id = responseIdFrom(event);
    return id ? [{ type: "response.created", id }] : [];
  }

  if (
    type === "response.output_text.delta" &&
    typeof event.delta === "string"
  ) {
    return [{ type: "text.delta", delta: event.delta }];
  }

  if (type === "response.output_item.added") {
    mergeResponsesToolCall(toolCalls, event.item);
    return [];
  }

  if (type === "response.output_item.done") {
    mergeResponsesToolCall(toolCalls, event.item);
    return emitReadyToolCalls(toolCalls);
  }

  if (type === "response.function_call_arguments.delta") {
    const key = toolCallKey(event);
    const existing = toolCalls.get(key) ?? {};
    existing.arguments = `${existing.arguments ?? ""}${typeof event.delta === "string" ? event.delta : ""}`;
    toolCalls.set(key, existing);
    return [];
  }

  if (type === "response.function_call_arguments.done") {
    const key = toolCallKey(event);
    const existing = toolCalls.get(key) ?? {};
    existing.finalized = true;

    if (typeof event.name === "string") {
      existing.name = event.name;
    }

    if (typeof event.arguments === "string") {
      existing.arguments = event.arguments;
      existing.rawProviderItem = {
        ...existing.rawProviderItem,
        type: "function_call",
        id: key,
        call_id: existing.callId,
        name: existing.name,
        arguments: event.arguments,
      };
    }
    toolCalls.set(key, existing);
    return emitReadyToolCalls(toolCalls);
  }

  if (type === "response.completed") {
    return [
      {
        type: "response.completed",
        id: responseIdFrom(event),
        outputText: outputTextFrom(event) ?? undefined,
        usage: isRecord(event.response) ? event.response.usage : event.usage,
      },
    ];
  }

  if (type === "error") {
    const error = isRecord(event.error) ? event.error : event;
    return [
      {
        type: "error",
        status: typeof event.status === "number" ? event.status : undefined,
        code: typeof error.code === "string" ? error.code : undefined,
        message:
          typeof error.message === "string"
            ? error.message
            : "Responses websocket stream failed",
      },
    ];
  }

  return [];
}

function mergeResponsesToolCall(
  toolCalls: Map<string, PendingResponsesToolCall>,
  item: unknown,
) {
  if (!isRecord(item) || item.type !== "function_call") {
    return;
  }

  const key =
    typeof item.id === "string"
      ? item.id
      : typeof item.call_id === "string"
        ? item.call_id
        : undefined;

  if (!key) {
    return;
  }

  const existing = toolCalls.get(key) ?? {};

  if (typeof item.call_id === "string") {
    existing.callId = item.call_id;
  } else if (!existing.callId) {
    existing.callId = key;
  }

  if (typeof item.id === "string") {
    existing.providerItemId = item.id;
  }

  if (typeof item.name === "string") {
    existing.name = item.name;
  }

  if (typeof item.arguments === "string") {
    existing.arguments = item.arguments;
  }

  if (item.status === "completed") {
    existing.finalized = true;
  }

  existing.rawProviderItem = item;
  toolCalls.set(key, existing);
}

function emitReadyToolCalls(toolCalls: Map<string, PendingResponsesToolCall>) {
  const events: ModelStreamEvent[] = [];

  for (const toolCall of toolCalls.values()) {
    if (
      toolCall.emitted ||
      !toolCall.finalized ||
      !toolCall.callId ||
      !toolCall.name ||
      toolCall.arguments === undefined
    ) {
      continue;
    }

    toolCall.emitted = true;
    events.push({
      type: "tool_call",
      callId: toolCall.callId,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  return events;
}

function completedToolCalls(toolCalls: Map<string, PendingResponsesToolCall>) {
  return [...toolCalls.values()].flatMap((toolCall) => {
    if (
      !toolCall.finalized ||
      !toolCall.callId ||
      !toolCall.name ||
      toolCall.arguments === undefined
    ) {
      return [];
    }

    return [
      {
        type: "function_call" as const,
        callId: toolCall.callId,
        name: toolCall.name,
        arguments: toolCall.arguments,
        providerItemId: toolCall.providerItemId,
        rawProviderItem: toolCall.rawProviderItem,
      },
    ];
  });
}

type PendingResponsesToolCall = {
  callId?: string;
  name?: string;
  arguments?: string;
  providerItemId?: string;
  rawProviderItem?: Record<string, unknown>;
  finalized?: boolean;
  emitted?: boolean;
};

function responseIdFrom(event: Record<string, unknown>) {
  if (typeof event.id === "string") {
    return event.id;
  }

  return isRecord(event.response) && typeof event.response.id === "string"
    ? event.response.id
    : undefined;
}

function outputTextFrom(event: Record<string, unknown>) {
  if (typeof event.output_text === "string") {
    return event.output_text;
  }

  if (
    isRecord(event.response) &&
    typeof event.response.output_text === "string"
  ) {
    return event.response.output_text;
  }

  return undefined;
}

function toolCallKey(event: Record<string, unknown>) {
  if (typeof event.item_id === "string") {
    return event.item_id;
  }

  if (typeof event.call_id === "string") {
    return event.call_id;
  }

  return "unknown";
}

function responsesWebSocketUrl(baseUrl: string) {
  const url = new URL("responses", normalizeBaseUrl(baseUrl));
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url;
}
