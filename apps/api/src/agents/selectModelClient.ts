import { ChatCompletionsClient } from "@/modelClients/ChatCompletionsClient";
import type { ConversationStore } from "@/modelClients/conversationStore";
import { ResponsesClient } from "@/modelClients/ResponsesClient";
import type { ModelClient, ProviderAuth } from "@/modelClients/types";
import type { ProviderRecord } from "@/providerStore";

export type ModelClientTransport = "responses" | "chat_completions";

export type CreateTurnModelClientInput = {
  provider: ProviderRecord;
  auth: ProviderAuth;
  conversationStore: ConversationStore;
};

export function selectModelClientTransport(provider: ProviderRecord): ModelClientTransport {
  return provider.key === "openai" ? "responses" : "chat_completions";
}

export function createTurnModelClient(input: CreateTurnModelClientInput): ModelClient {
  const transport = selectModelClientTransport(input.provider);

  if (transport === "responses") {
    return new ResponsesClient({
      auth: input.auth,
      providerKey: input.provider.key,
      baseUrl: input.provider.baseUrl,
      conversationStore: input.conversationStore
    });
  }

  return new ChatCompletionsClient({
    auth: input.auth,
    providerKey: input.provider.key,
    baseUrl: input.provider.baseUrl,
    conversationStore: input.conversationStore
  });
}

