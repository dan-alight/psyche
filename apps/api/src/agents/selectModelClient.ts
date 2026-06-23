import { ChatCompletionsClient } from "@/modelClients/ChatCompletionsClient";
import { ResponsesClient } from "@/modelClients/ResponsesClient";
import type {
  ModelClient,
  ModelCallRequest,
  ModelClientTransport,
  ProviderAuth,
} from "@/modelClients/types";
import type { ProviderRecord } from "@/providerStore";

const codexResponsesBaseUrl = "https://chatgpt.com/backend-api/codex";
const codexRequiredInstructions = "You are a helpful assistant.";

export type CreateTurnModelClientInput = {
  provider: ProviderRecord;
  auth: ProviderAuth;
};

export function selectModelClientTransport(
  provider: ProviderRecord,
): ModelClientTransport {
  return provider.key === "openai" ? "responses" : "chat_completions";
}

export function createTurnModelClient(
  input: CreateTurnModelClientInput,
): ModelClient {
  const transport = selectModelClientTransport(input.provider);

  if (transport === "responses") {
    const usesChatGptOAuth = !!input.auth.openai?.chatgpt;
    const client = new ResponsesClient({
      auth: input.auth,
      baseUrl: usesChatGptOAuth
        ? codexResponsesBaseUrl
        : input.provider.baseUrl,
    });

    return usesChatGptOAuth ? new CodexOAuthResponsesClient(client) : client;
  }

  return new ChatCompletionsClient({
    auth: input.auth,
    baseUrl: input.provider.baseUrl,
  });
}

class CodexOAuthResponsesClient implements ModelClient {
  constructor(private readonly client: ModelClient) {}

  stream(request: ModelCallRequest) {
    return this.client.stream(toCodexOAuthRequest(request));
  }

  close() {
    this.client.close?.();
  }
}

export function toCodexOAuthRequest(request: ModelCallRequest): ModelCallRequest {
  return {
    ...request,
    instructions: request.instructions ?? codexRequiredInstructions,
    store: request.store ?? false,
  };
}
