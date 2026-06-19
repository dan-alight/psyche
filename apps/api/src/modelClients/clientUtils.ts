import type {
  ConversationState,
  ConversationStore,
} from "@/modelClients/conversationStore";
import type {
  ModelCallRequest,
  ModelFunctionCallInput,
  ProviderAuth,
} from "@/modelClients/types";

export type CompleteConversationTurnInput = {
  conversationId?: number;
  request: ModelCallRequest;
  responseId?: string;
  outputText?: string;
  toolCalls: ModelFunctionCallInput[];
  usage?: unknown;
};

export async function getConversationState(
  conversationState: Map<number, ConversationState>,
  conversationStore: ConversationStore,
  request: ModelCallRequest,
  providerKey: string,
) {
  if (request.conversationId === undefined) {
    return undefined;
  }

  const cached = conversationState.get(request.conversationId);

  if (cached) {
    return cached;
  }

  const state = await conversationStore.getState(
    request.conversationId,
    providerKey,
  );
  conversationState.set(request.conversationId, state);
  return state;
}

export async function completeConversationTurn(
  conversationState: Map<number, ConversationState>,
  conversationStore: ConversationStore,
  providerKey: string,
  input: CompleteConversationTurnInput,
) {
  const state = await conversationStore.appendModelCall({
    conversationId: input.conversationId,
    providerKey,
    model: input.request.model,
    previousResponseId:
      input.conversationId === undefined
        ? undefined
        : conversationState.get(input.conversationId)?.previousResponseId,
    responseId: input.responseId,
    usage: input.usage,
    tools: input.request.tools,
    input: input.request.input,
    outputText: input.outputText,
    functionCalls: input.toolCalls,
  });

  conversationState.set(state.conversationId, state);
  return state;
}

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function providerHeaders(
  auth: ProviderAuth,
  options: { contentType?: boolean } = {},
) {
  return {
    Authorization: `Bearer ${auth.bearerToken}`,
    ...(options.contentType ? { "Content-Type": "application/json" } : {}),
    ...optionalHeader("OpenAI-Organization", auth.organization),
    ...optionalHeader("OpenAI-Project", auth.project),
  };
}

export function parseJsonRecord(
  value: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalHeader(name: string, value: string | undefined) {
  return value ? { [name]: value } : {};
}
