import type { ClientRequest, IncomingMessage } from "node:http";

import WebSocket from "ws";

import {
  isRecord,
  normalizeBaseUrl,
  parseJsonRecord,
  providerHeaders,
} from "@/modelClients/clientUtils";
import { toResponsesCreateEvent } from "@/modelClients/requestMapping";
import type {
  ModelCallRequest,
  ModelClient,
  ModelStreamEvent,
  ProviderAuth,
} from "@/modelClients/types";

export type ResponsesClientOptions = {
  auth: ProviderAuth;
  baseUrl: string;
  webSocketFactory?: (
    url: URL,
    options: { headers: Record<string, string> },
  ) => WebSocket;
};

export class ResponsesClient implements ModelClient {
  private socket?: WebSocket;
  private inFlight = false;

  constructor(private readonly options: ResponsesClientOptions) {}

  async *stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent> {
    if (request.store === false) {
      throw new Error(
        "Responses conversations require store=true for resumable previous_response_id continuity",
      );
    }

    if (this.inFlight) {
      throw new Error("Responses websocket already has an in-flight response");
    }

    this.inFlight = true;

    let responseId: string | undefined;
    let outputText = "";
    let usage: unknown;
    const toolCalls = new Map<string, PendingResponsesToolCall>();

    try {
      let socket: WebSocket;

      try {
        socket = await this.ensureSocket(request.signal);
      } catch (error) {
        const errorEvent = toWebSocketOpenErrorEvent(error);

        if (errorEvent) {
          yield errorEvent;
          return;
        }

        throw error;
      }

      const responseCreateEvent = {
        ...toResponsesCreateEvent(request, {
          previousResponseId: request.previousResponseId,
        }),
        store: request.store ?? true,
      };
      const events = readWebSocketEvents(socket, request.signal);
      socket.send(JSON.stringify(responseCreateEvent));

      for await (const rawEvent of events) {
        const event = parseJsonRecord(rawEvent);

        if (!event) {
          throw new Error("Failed to parse responses websocket stream event");
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
      throw new Error("Responses websocket closed before response completed");
    } catch (error) {
      this.close();
      throw error instanceof Error
        ? error
        : new Error("Responses websocket stream failed");
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
      socket.off("unexpected-response", onUnexpectedResponse);
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
    const onUnexpectedResponse = async (
      _request: ClientRequest,
      response: IncomingMessage,
    ) => {
      cleanup();

      try {
        reject(
          toWebSocketUnexpectedResponseError(
            response,
            await readIncomingMessage(response),
          ),
        );
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Responses websocket upgrade failed"),
        );
      }
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
    socket.once("unexpected-response", onUnexpectedResponse);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (socket.readyState === WebSocket.OPEN) {
      onOpen();
    }
  });
}

async function readIncomingMessage(response: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function toWebSocketUnexpectedResponseError(
  response: IncomingMessage,
  body: string,
) {
  const parsed = parseJsonRecord(body);
  const error = isRecord(parsed?.error) ? parsed.error : parsed;
  const message =
    typeof error?.message === "string"
      ? error.message
      : response.statusMessage || "Responses websocket upgrade failed";

  return Object.assign(new Error(message), {
    status: response.statusCode,
    code: typeof error?.code === "string" ? error.code : undefined,
  });
}

function toWebSocketOpenErrorEvent(error: unknown): ModelStreamEvent | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status =
    typeof error.status === "number"
      ? error.status
      : typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;

  if (status === undefined) {
    return undefined;
  }

  return {
    type: "error",
    status,
    code: typeof error.code === "string" ? error.code : undefined,
    message:
      error instanceof Error
        ? error.message
        : "Responses websocket upgrade failed",
  };
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
      providerItemId: toolCall.providerItemId,
      rawProviderItem: toolCall.rawProviderItem,
    });
  }

  return events;
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
