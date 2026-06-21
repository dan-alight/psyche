import {
  isRecord,
  normalizeBaseUrl,
  parseJsonRecord,
  providerHeaders,
} from "@/modelClients/clientUtils";
import { toChatCompletionsBody } from "@/modelClients/requestMapping";
import type {
  ModelCallRequest,
  ModelClient,
  ModelStreamEvent,
  ProviderAuth,
} from "@/modelClients/types";

export type ChatCompletionsClientOptions = {
  auth: ProviderAuth;
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class ChatCompletionsClient implements ModelClient {
  constructor(private readonly options: ChatCompletionsClientOptions) {}

  async *stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent> {
    const body = toChatCompletionsBody(request, request.historyItems);

    const fetchImpl = this.options.fetchImpl ?? fetch;
    let responseId: string | undefined;
    let response: Response;

    try {
      response = await fetchImpl(
        new URL("chat/completions", normalizeBaseUrl(this.options.baseUrl)),
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "Chat completions stream failed",
      );
    }

    if (!response.ok) {
      const errorEvent = await toHttpErrorEvent(response);

      if (!errorEvent) {
        throw new Error(response.statusText || "Chat completions request failed");
      }

      yield errorEvent;
      return;
    }

    if (!response.body) {
      throw new Error("Chat completions response did not include a stream body");
    }

    let outputText = "";
    let usage: unknown;
    let createdEmitted = false;
    let sawDone = false;
    const toolCalls = new Map<number, PendingChatToolCall>();

    try {
      for await (const data of readServerSentEvents(response.body)) {
        if (data === "[DONE]") {
          sawDone = true;
          break;
        }

        const chunk = parseJsonRecord(data);

        if (!chunk) {
          throw new Error("Failed to parse chat completions stream event");
        }

        if (isErrorChunk(chunk)) {
          yield toErrorEvent(chunk.error);
          return;
        }

        if (!createdEmitted && typeof chunk.id === "string") {
          responseId = chunk.id;
          createdEmitted = true;
          yield { type: "response.created", id: responseId };
        }

        usage = chunk.usage ?? usage;

        const choice = Array.isArray(chunk.choices)
          ? chunk.choices[0]
          : undefined;
        const delta = isRecord(choice?.delta) ? choice.delta : undefined;
        const content = delta?.content;

        if (typeof content === "string" && content.length > 0) {
          outputText += content;
          yield { type: "text.delta", delta: content };
        }

        if (Array.isArray(delta?.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            mergeChatToolCallDelta(toolCalls, toolCallDelta);
          }
        }
      }
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "Chat completions stream failed",
      );
    }

    if (!sawDone) {
      throw new Error("Chat completions stream closed before [DONE]");
    }

    const completedToolCalls = [...toolCalls.values()].flatMap((toolCall) => {
      if (
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
        },
      ];
    });

    for (const toolCall of completedToolCalls) {
      yield {
        type: "tool_call",
        callId: toolCall.callId,
        name: toolCall.name,
        arguments: toolCall.arguments,
      };
    }

    yield {
      type: "response.completed",
      id: responseId,
      outputText: outputText || undefined,
      usage,
    };
  }

  private headers() {
    return providerHeaders(this.options.auth, { contentType: true });
  }
}

async function* readServerSentEvents(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const data = part
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");

      if (data) {
        yield data;
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const data = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (data) {
      yield data;
    }
  }
}

async function toHttpErrorEvent(
  response: Response,
): Promise<ModelStreamEvent | undefined> {
  const body = parseJsonRecord(await response.text());
  const error = isRecord(body?.error) ? body.error : body;
  const message =
    typeof error?.message === "string" ? error.message : undefined;

  if (!message && typeof error?.code !== "string") {
    return undefined;
  }

  return {
    type: "error",
    status: response.status,
    code: typeof error?.code === "string" ? error.code : undefined,
    message: message ?? response.statusText,
  };
}

function mergeChatToolCallDelta(
  toolCalls: Map<number, PendingChatToolCall>,
  value: unknown,
) {
  if (!isRecord(value) || typeof value.index !== "number") {
    return;
  }

  const existing = toolCalls.get(value.index) ?? {};

  if (typeof value.id === "string") {
    existing.callId = value.id;
  }

  if (isRecord(value.function)) {
    if (typeof value.function.name === "string") {
      existing.name = value.function.name;
    }

    if (typeof value.function.arguments === "string") {
      existing.arguments = `${existing.arguments ?? ""}${value.function.arguments}`;
    }
  }

  toolCalls.set(value.index, existing);
}

type PendingChatToolCall = {
  callId?: string;
  name?: string;
  arguments?: string;
};

function isErrorChunk(
  value: Record<string, unknown>,
): value is { error: Record<string, unknown> } {
  return isRecord(value.error);
}

function toErrorEvent(error: Record<string, unknown>): ModelStreamEvent {
  return {
    type: "error",
    status: typeof error.status === "number" ? error.status : undefined,
    code: typeof error.code === "string" ? error.code : undefined,
    message:
      typeof error.message === "string" ? error.message : "Model stream failed",
  };
}
