import type { ModelCallRequest, ModelClient, ModelStreamEvent, ProviderAuth } from "@/modelClients/types";
import { toChatCompletionsBody } from "@/modelClients/requestMapping";

export type ChatCompletionsClientOptions = {
  baseUrl: string;
  auth: ProviderAuth;
  fetchImpl?: typeof fetch;
};

export class ChatCompletionsClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly auth: ProviderAuth;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ChatCompletionsClientOptions) {
    this.baseUrl = options.baseUrl;
    this.auth = options.auth;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.fetchImpl(this.chatCompletionsUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(toChatCompletionsBody(request)),
      signal: request.signal
    });

    if (!response.ok) {
      yield {
        type: "error",
        status: response.status,
        message: await response.text()
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Chat Completions response did not include a stream body" };
      return;
    }

    let outputText = "";

    for await (const payload of readServerSentEvents(response.body)) {
      if (payload === "[DONE]") {
        yield { type: "response.completed", outputText };
        return;
      }

      const event = parseChatCompletionChunk(payload);

      if (!event) {
        continue;
      }

      if (event.type === "text.delta") {
        outputText += event.delta;
      }

      yield event;
    }
  }

  private chatCompletionsUrl() {
    const url = new URL(this.baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
    return url.toString();
  }

  private headers() {
    return {
      authorization: `Bearer ${this.auth.bearerToken}`,
      "content-type": "application/json",
      ...(this.auth.organization ? { "openai-organization": this.auth.organization } : {}),
      ...(this.auth.project ? { "openai-project": this.auth.project } : {})
    };
  }
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");

      if (data) {
        yield data;
      }
    }
  }
}

function parseChatCompletionChunk(raw: string): ModelStreamEvent | undefined {
  const payload = JSON.parse(raw) as {
    id?: string;
    choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: unknown;
  };
  const choice = payload.choices?.[0];

  if (!choice) {
    return undefined;
  }

  const toolCall = choice.delta?.tool_calls?.[0];

  if (toolCall) {
    return {
      type: "tool_call",
      callId: toolCall.id ?? "",
      name: toolCall.function?.name ?? "",
      arguments: toolCall.function?.arguments ?? ""
    };
  }

  if (choice.delta?.content) {
    return { type: "text.delta", delta: choice.delta.content };
  }

  if (choice.finish_reason) {
    return {
      type: "response.completed",
      id: payload.id,
      usage: payload.usage
    };
  }

  return undefined;
}
