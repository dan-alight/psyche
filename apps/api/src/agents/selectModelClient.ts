import { ChatCompletionsClient } from "@/modelClients/ChatCompletionsClient";
import { ResponsesClient } from "@/modelClients/ResponsesClient";
import type {
  ModelClient,
  ModelClientTransport,
  ProviderAuth,
} from "@/modelClients/types";
import type { ProviderRecord } from "@/providerStore";

export type CreateTurnModelClientInput = {
  provider: ProviderRecord;
  auth: ProviderAuth;
};

export function selectModelClientTransport(provider: ProviderRecord): ModelClientTransport {
  return provider.key === "openai" ? "responses" : "chat_completions";
}

export function createTurnModelClient(input: CreateTurnModelClientInput): ModelClient {
  const transport = selectModelClientTransport(input.provider);

  if (transport === "responses") {
    return new ResponsesClient({
      auth: input.auth,
      baseUrl: input.provider.baseUrl
    });
  }

  return new ChatCompletionsClient({
    auth: input.auth,
    baseUrl: input.provider.baseUrl
  });
}
