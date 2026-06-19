import {
  createDrizzleConversationStore,
  type ConversationStore,
} from "@/modelClients/conversationStore";
import {
  resolveActiveProviderAuth,
  type ResolveActiveProviderAuthInput,
} from "@/modelClients/credentials";
import type {
  ModelCallRequest,
  ModelClient,
  ModelStreamEvent,
  ProviderAuth,
} from "@/modelClients/types";
import type { ProviderAccessStore, ProviderRecord } from "@/providerStore";
import { createTurnModelClient } from "@/agents/selectModelClient";
import type { AgentRunEvent, AgentRunInput } from "@/agents/types";

export type AgentHarnessOptions = {
  store: ProviderAccessStore;
  credentialEncryptionKey: string;
  conversationStore?: ConversationStore;
  refreshOAuthToken?: ResolveActiveProviderAuthInput["refreshOAuthToken"];
  createModelClient?: (input: {
    provider: ProviderRecord;
    auth: ProviderAuth;
    conversationStore: ConversationStore;
  }) => ModelClient;
};

type StreamTurnResult = {
  needsFreshCredentials: boolean;
  failed?: Extract<ModelStreamEvent, { type: "error" }>;
  conversationId?: number;
  responseId?: string;
};

export class AgentHarness {
  constructor(private readonly options: AgentHarnessOptions) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentRunEvent> {
    yield {
      type: "run.started",
      providerKey: input.providerKey,
      model: input.model,
      conversationId: input.conversationId,
    };

    try {
      if (input.maxTurns !== undefined && input.maxTurns < 1) {
        throw new Error("maxTurns must be at least 1");
      }

      const provider = await this.options.store.getProviderByKey(
        input.providerKey,
      );

      if (!provider) {
        throw new Error(`Provider '${input.providerKey}' is not configured`);
      }

      const conversationStore =
        this.options.conversationStore ?? createDrizzleConversationStore();
      const request = toModelCallRequest(input);
      const firstClient = await this.createClient(
        provider,
        conversationStore,
        false,
      );
      let result: StreamTurnResult = { needsFreshCredentials: false };

      try {
        result = yield* streamTurnUntilCredentialRefreshNeeded(
          firstClient,
          request,
        );
      } finally {
        firstClient.close?.();
      }

      if (result.needsFreshCredentials) {
        const refreshedClient = await this.createClient(
          provider,
          conversationStore,
          true,
        );

        try {
          result = yield* streamTurnUntilCredentialRefreshNeeded(
            refreshedClient,
            request,
          );
        } finally {
          refreshedClient.close?.();
        }
      }

      if (result.needsFreshCredentials) {
        yield {
          type: "run.failed",
          message: "Model authentication failed after refreshing credentials",
        };
        return;
      }

      if (result.failed) {
        yield {
          type: "run.failed",
          status: result.failed.status,
          code: result.failed.code,
          message: result.failed.message,
        };
        return;
      }

      yield {
        type: "run.completed",
        conversationId: result.conversationId ?? input.conversationId,
        responseId: result.responseId,
      };
    } catch (error) {
      yield {
        type: "run.failed",
        message: error instanceof Error ? error.message : "Agent run failed",
      };
    }
  }

  private async createClient(
    provider: ProviderRecord,
    conversationStore: ConversationStore,
    forceRefresh: boolean,
  ) {
    const auth = await resolveActiveProviderAuth({
      store: this.options.store,
      providerKey: provider.key,
      credentialEncryptionKey: this.options.credentialEncryptionKey,
      forceRefresh,
      refreshOAuthToken: this.options.refreshOAuthToken,
    });

    return (this.options.createModelClient ?? createTurnModelClient)({
      provider,
      auth,
      conversationStore,
    });
  }
}

function toModelCallRequest(input: AgentRunInput): ModelCallRequest {
  return {
    conversationId: input.conversationId,
    model: input.model,
    instructions: input.instructions,
    input: input.input,
    tools: input.tools,
    store: input.store,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    responseFormat: input.responseFormat,
    reasoning: input.reasoning,
    verbosity: input.verbosity,
    metadata: input.metadata,
    signal: input.signal,
  };
}

function isAuthFailure(event: ModelStreamEvent) {
  return (
    event.type === "error" &&
    (event.status === 401 ||
      event.code === "invalid_api_key" ||
      event.code === "invalid_token")
  );
}

function isModelWork(event: ModelStreamEvent) {
  return (
    event.type === "text.delta" ||
    event.type === "tool_call" ||
    event.type === "response.completed"
  );
}

async function* streamTurnUntilCredentialRefreshNeeded(
  client: ModelClient,
  request: ModelCallRequest,
): AsyncGenerator<ModelStreamEvent, StreamTurnResult, void> {
  let emittedModelWork = false;
  const pendingEvents: ModelStreamEvent[] = [];
  const result: StreamTurnResult = {
    needsFreshCredentials: false,
  };

  for await (const event of client.stream(request)) {
    if (isAuthFailure(event) && !emittedModelWork) {
      return {
        ...result,
        needsFreshCredentials: true,
      };
    }

    updateResult(result, event);

    if (isModelWork(event)) {
      emittedModelWork = true;
      yield* pendingEvents.splice(0);
    }

    if (emittedModelWork) {
      yield event;
    } else {
      pendingEvents.push(event);
    }
  }

  yield* pendingEvents;
  return result;
}

function updateResult(result: StreamTurnResult, event: ModelStreamEvent) {
  if (event.type === "conversation.created") {
    result.conversationId = event.conversationId;
    return;
  }

  if (
    event.type === "response.created" ||
    event.type === "response.completed"
  ) {
    result.responseId = event.id ?? result.responseId;
    return;
  }

  if (event.type === "error") {
    result.failed = event;
  }
}
