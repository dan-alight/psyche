import WebSocket from "ws";

import type { ModelCallRequest, ModelClient, ModelStreamEvent, ProviderAuth } from "@/modelClients/types";
import { toResponsesCreateEvent } from "@/modelClients/requestMapping";

type WebSocketFactory = (url: string, options: { headers: Record<string, string> }) => WebSocket;

export type ResponsesClientOptions = {
  baseUrl: string;
  auth: ProviderAuth;
  webSocketFactory?: WebSocketFactory;
};

export class ResponsesClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly auth: ProviderAuth;
  private readonly webSocketFactory: WebSocketFactory;

  constructor(options: ResponsesClientOptions) {
    this.baseUrl = options.baseUrl;
    this.auth = options.auth;
    this.webSocketFactory = options.webSocketFactory ?? ((url, socketOptions) => new WebSocket(url, socketOptions));
  }

  async *stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent> {
    const socket = this.webSocketFactory(this.responsesUrl(), {
      headers: this.headers()
    });
    const queue: ModelStreamEvent[] = [];
    const waiters: Array<() => void> = [];
    let done = false;

    const push = (event: ModelStreamEvent) => {
      queue.push(event);
      waiters.splice(0).forEach((resolve) => resolve());
    };
    const finish = () => {
      done = true;
      waiters.splice(0).forEach((resolve) => resolve());
    };
    const waitForEvent = () => new Promise<void>((resolve) => waiters.push(resolve));

    const abort = () => {
      socket.close();
      finish();
    };

    request.signal?.addEventListener("abort", abort, { once: true });

    socket.once("open", () => {
      socket.send(JSON.stringify(toResponsesCreateEvent(request)));
    });
    socket.on("message", (data) => {
      let event: ModelStreamEvent | undefined;

      try {
        event = parseResponsesEvent(data.toString());
      } catch (error) {
        push({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to parse Responses WebSocket event"
        });
        finish();
        socket.close();
        return;
      }

      if (event) {
        push(event);
      }

      if (event?.type === "response.completed" || event?.type === "error") {
        finish();
        socket.close();
      }
    });
    socket.once("error", (error) => {
      push({ type: "error", message: error.message });
      finish();
    });
    socket.once("close", finish);

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await waitForEvent();
          continue;
        }

        yield queue.shift()!;
      }
    } finally {
      request.signal?.removeEventListener("abort", abort);
      socket.close();
    }
  }

  private responsesUrl() {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/responses`;
    return url.toString();
  }

  private headers() {
    return {
      authorization: `Bearer ${this.auth.bearerToken}`,
      ...(this.auth.organization ? { "openai-organization": this.auth.organization } : {}),
      ...(this.auth.project ? { "openai-project": this.auth.project } : {})
    };
  }
}

function parseResponsesEvent(raw: string): ModelStreamEvent | undefined {
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const type = payload.type;

  if (type === "response.created") {
    const response = payload.response as { id?: string } | undefined;
    return { type: "response.created", id: response?.id ?? String(payload.id ?? "") };
  }

  if (type === "response.output_text.delta" || type === "response.text.delta") {
    return { type: "text.delta", delta: String(payload.delta ?? "") };
  }

  if (type === "response.output_item.done") {
    const item = payload.item as Record<string, unknown> | undefined;

    if (item?.type === "function_call") {
      return {
        type: "tool_call",
        callId: String(item.call_id ?? ""),
        name: String(item.name ?? ""),
        arguments: String(item.arguments ?? "")
      };
    }
  }

  if (type === "response.completed") {
    const response = payload.response as { id?: string; output_text?: string; usage?: unknown } | undefined;
    return {
      type: "response.completed",
      id: response?.id,
      outputText: response?.output_text,
      usage: response?.usage
    };
  }

  if (type === "error") {
    const error = payload.error as { code?: string; message?: string } | undefined;
    return {
      type: "error",
      status: typeof payload.status === "number" ? payload.status : undefined,
      code: error?.code,
      message: error?.message ?? "Responses WebSocket error"
    };
  }

  return undefined;
}
