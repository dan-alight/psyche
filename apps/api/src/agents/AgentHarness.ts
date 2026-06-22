import type { StartedModelCall } from "@/modelClients/conversationStore";
import {
  ConversationManager,
  getConversationManager,
} from "@/conversations/ConversationManager";
import {
  resolveActiveProviderAuth,
  type ResolveActiveProviderAuthInput,
} from "@/modelClients/credentials";
import type {
  ModelCallRequest,
  ModelClient,
  ModelFunctionCallInput,
  ModelInput,
  ModelStreamEvent,
  ProviderAuth,
} from "@/modelClients/types";
import type { ProviderAccessStore, ProviderRecord } from "@/providerStore";
import {
  createTurnModelClient,
  selectModelClientTransport,
} from "@/agents/selectModelClient";
import type { AgentRunInput } from "@/agents/types";

export type AgentHarnessOptions = {
  store: ProviderAccessStore;
  credentialEncryptionKey: string;
  conversationManager?: ConversationManager;
  refreshOAuthToken?: ResolveActiveProviderAuthInput["refreshOAuthToken"];
  createModelClient?: (input: {
    provider: ProviderRecord;
    auth: ProviderAuth;
  }) => ModelClient;
};

type CapturedModelOutput = {
  responseId?: string;
  outputText?: string;
  functionCalls: ModelFunctionCallInput[];
  usage?: unknown;
};

type ModelStreamAttemptResult =
  | {
      status: "needs_fresh_credentials";
      output: CapturedModelOutput;
    }
  | {
      status: "failed";
      output: CapturedModelOutput;
      error: Extract<ModelStreamEvent, { type: "error" }>;
    }
  | {
      status: "incomplete";
      output: CapturedModelOutput;
    }
  | {
      status: "completed";
      output: CapturedModelOutput;
    };

type CapturedModelOutputUpdate = {
  completed?: boolean;
  failure?: Extract<ModelStreamEvent, { type: "error" }>;
};

export class AgentHarness {
  constructor(private readonly options: AgentHarnessOptions) {}

  async run(input: AgentRunInput): Promise<void> {
    let startedModelCall: StartedModelCall | undefined;
    let streamResult: ModelStreamAttemptResult = {
      status: "incomplete",
      output: emptyCapturedModelOutput(),
    };

    const conversationManager = this.resolveConversationManager();
    const modelInput = toUserPromptModelInput(input.input);
    let modelCallFinished = false;

    try {
      const provider = await this.options.store.getProviderByKey(
        input.providerKey,
      );

      if (!provider) {
        throw new Error(`Provider '${input.providerKey}' is not configured`);
      }

      const transport = selectModelClientTransport(provider);

      startedModelCall = await conversationManager.startModelCall({
        providerKey: input.providerKey,
        model: input.model,
        transport,
        input: modelInput,
        transcriptUserPrompt: input.input,
      });
      const request = toModelCallRequest(input, startedModelCall, modelInput);
      const { conversationId, modelCallId } = startedModelCall;
      const recordTextDelta = async (delta: string) => {
        await conversationManager.recordTextDelta({
          conversationId,
          modelCallId,
          delta,
        });
      };

      const firstClient = await this.createClient(provider, false);

      try {
        streamResult = await streamModelAttempt(
          firstClient,
          request,
          recordTextDelta,
        );
      } finally {
        firstClient.close?.();
      }

      if (streamResult.status === "needs_fresh_credentials") {
        const refreshedClient = await this.createClient(provider, true);

        try {
          streamResult = await streamModelAttempt(
            refreshedClient,
            request,
            recordTextDelta,
          );
        } finally {
          refreshedClient.close?.();
        }
      }

      if (streamResult.status === "needs_fresh_credentials") {
        await failModelCall(
          conversationManager,
          startedModelCall,
          streamResult.output,
        );
        modelCallFinished = true;
        throw new Error(
          "Model authentication failed after refreshing credentials",
        );
      }

      if (streamResult.status === "failed") {
        await failModelCall(
          conversationManager,
          startedModelCall,
          streamResult.output,
        );
        modelCallFinished = true;
        throw modelStreamError(streamResult.error);
      }

      if (streamResult.status === "incomplete") {
        await failModelCall(
          conversationManager,
          startedModelCall,
          streamResult.output,
        );
        modelCallFinished = true;
        throw new Error("Model stream ended before response completed");
      }

      await conversationManager.completeModelCall({
        conversationId: startedModelCall.conversationId,
        modelCallId: startedModelCall.modelCallId,
        responseId: streamResult.output.responseId,
        outputText: streamResult.output.outputText,
        functionCalls: streamResult.output.functionCalls,
        usage: streamResult.output.usage,
      });
      modelCallFinished = true;
    } catch (error) {
      if (startedModelCall && !modelCallFinished) {
        await tryFailModelCall(
          conversationManager,
          startedModelCall,
          streamResult.output,
        );
      }

      throw error;
    }
  }

  private async createClient(provider: ProviderRecord, forceRefresh: boolean) {
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
    });
  }

  private resolveConversationManager() {
    if (this.options.conversationManager) {
      return this.options.conversationManager;
    }

    return getConversationManager();
  }
}

function toModelCallRequest(
  input: AgentRunInput,
  startedModelCall: StartedModelCall,
  modelInput: ModelInput[],
): ModelCallRequest {
  return {
    previousResponseId: startedModelCall.requestContext.previousResponseId,
    historyItems: startedModelCall.requestContext.historyItems,
    model: input.model,
    input: modelInput,
  };
}

function toUserPromptModelInput(input: string): ModelInput[] {
  return [
    {
      type: "message",
      role: "user",
      content: input,
    },
  ];
}

function modelStreamError(event: Extract<ModelStreamEvent, { type: "error" }>) {
  const error = new Error(event.message);

  return Object.assign(error, {
    status: event.status,
    code: event.code,
  });
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

function emptyCapturedModelOutput(): CapturedModelOutput {
  return {
    functionCalls: [],
  };
}

async function failModelCall(
  conversationStore: Pick<ConversationManager, "failModelCall">,
  startedModelCall: StartedModelCall,
  output: CapturedModelOutput,
) {
  await conversationStore.failModelCall({
    conversationId: startedModelCall.conversationId,
    modelCallId: startedModelCall.modelCallId,
    responseId: output.responseId,
  });
}

async function tryFailModelCall(
  conversationStore: Pick<ConversationManager, "failModelCall">,
  startedModelCall: StartedModelCall,
  output: CapturedModelOutput,
) {
  try {
    await failModelCall(conversationStore, startedModelCall, output);
  } catch {
    // Preserve the model/client failure that led to this cleanup path.
  }
}

async function streamModelAttempt(
  client: ModelClient,
  request: ModelCallRequest,
  onTextDelta: (delta: string) => Promise<void>,
): Promise<ModelStreamAttemptResult> {
  let emittedModelWork = false;
  const output = emptyCapturedModelOutput();
  let completed = false;
  let failure: Extract<ModelStreamEvent, { type: "error" }> | undefined;

  for await (const event of client.stream(request)) {
    const update = captureModelOutput(output, event);
    completed = update.completed || completed;
    failure = update.failure ?? failure;

    if (isAuthFailure(event) && !emittedModelWork) {
      return {
        status: "needs_fresh_credentials",
        output,
      };
    }

    if (isModelWork(event)) {
      emittedModelWork = true;
    }

    if (emittedModelWork) {
      if (event.type === "text.delta") {
        await onTextDelta(event.delta);
      }
    }
  }

  if (failure) {
    return { status: "failed", output, error: failure };
  }

  if (completed) {
    return { status: "completed", output };
  }

  return { status: "incomplete", output };
}

function captureModelOutput(
  output: CapturedModelOutput,
  event: ModelStreamEvent,
): CapturedModelOutputUpdate {
  if (event.type === "tool_call") {
    output.functionCalls.push({
      type: "function_call",
      callId: event.callId,
      name: event.name,
      arguments: event.arguments,
      providerItemId: event.providerItemId,
      rawProviderItem: event.rawProviderItem,
    });
    return {};
  }

  if (event.type === "response.created") {
    output.responseId = event.id ?? output.responseId;
    return {};
  }

  if (event.type === "response.completed") {
    output.responseId = event.id ?? output.responseId;
    output.outputText = event.outputText;
    output.usage = event.usage;
    return { completed: true };
  }

  if (event.type === "error") {
    return { failure: event };
  }

  return {};
}
