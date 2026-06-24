import { describe, expect, it, vi } from "vitest";

import { AgentHarness } from "@/agents/AgentHarness";
import { ConversationManager } from "@/conversations/ConversationManager";
import type { ConversationStore } from "@/modelClients/conversationStore";
import type { ModelCallRequest, ModelClient, ModelStreamEvent, ProviderAuth } from "@/modelClients/types";
import { encryptPayload } from "@/credentialCrypto";
import type { ConversationModelCall } from "@/db/schema";
import type { CredentialRecord, ProviderAccessStore, ProviderRecord } from "@/providerStore";

const secret = "test-credential-secret";

describe("AgentHarness", () => {
  it("streams one model turn with resolved provider credentials", async () => {
    const store = createStore({
      credential: {
        kind: "api_key",
        encryptedPayload: encryptPayload({ apiKey: "sk-test" }, secret)
      }
    });
    const createModelClient = vi.fn((input: CreateClientInput) => fakeClient([
      { type: "response.created", id: "resp_1" },
      { type: "text.delta", delta: "Hello" },
      { type: "response.completed", id: "resp_1", outputText: "Hello" }
    ]));
    const conversationStore = createConversationStore();
    const harness = new AgentHarness({
      store,
      credentialEncryptionKey: secret,
      conversationManager: new ConversationManager({
        store: conversationStore,
        initialTranscriptItemId: 0,
      }),
      createModelClient
    });

    await expect(harness.run({
      providerKey: "openai",
      model: "gpt-test",
      input: "Hi"
    })).resolves.toBeUndefined();

    expect(createModelClient).toHaveBeenCalledOnce();
    expect(createModelClient.mock.calls[0]![0]).toMatchObject({
      auth: { bearerToken: "sk-test" },
      provider: { key: "openai", baseUrl: "https://api.example.test/v1" }
    });
    expect(conversationStore.startedModelCalls).toEqual([{
      providerKey: "openai",
      model: "gpt-test",
      transport: "responses",
      input: [{ type: "message", role: "user", content: "Hi" }],
      transcriptUserPrompt: "Hi"
    }]);
    expect(conversationStore.completedModelCalls).toEqual([{
      conversationId: 42,
      modelCallId: 1,
      responseId: "resp_1",
      outputText: "Hello",
      functionCalls: [],
      usage: undefined
    }]);
  });

  it("refreshes OAuth credentials and retries when auth fails before model work", async () => {
    const store = createStore({
      credential: {
        kind: "oauth",
        encryptedPayload: encryptPayload({
          access_token: "old-token",
          refresh_token: "refresh-token"
        }, secret),
        expiresAt: new Date("2999-01-01T00:00:00Z")
      }
    });
    const refreshOAuthToken = vi.fn(async () => ({
      payload: { access_token: "new-token" },
      expiresAt: new Date("2999-01-02T00:00:00Z")
    }));
    const tokens: string[] = [];
    const createModelClient = vi.fn((input: CreateClientInput) => {
      tokens.push(input.auth.bearerToken);

      return tokens.length === 1
        ? fakeClient([{ type: "error", status: 401, code: "invalid_token", message: "expired" }])
        : fakeClient([
            { type: "response.created", id: "resp_retry" },
            { type: "text.delta", delta: "Recovered" },
            { type: "response.completed", id: "resp_retry", outputText: "Recovered" }
          ]);
    });
    const conversationStore = createConversationStore();
    const harness = new AgentHarness({
      store,
      credentialEncryptionKey: secret,
      conversationManager: new ConversationManager({
        store: conversationStore,
        initialTranscriptItemId: 0,
      }),
      refreshOAuthToken,
      createModelClient
    });

    await expect(harness.run({
      providerKey: "openai",
      model: "gpt-test",
      input: "Hi"
    })).resolves.toBeUndefined();

    expect(tokens).toEqual(["old-token", "new-token"]);
    expect(refreshOAuthToken).toHaveBeenCalledWith({
      tokenUrl: "https://auth.example.test/token",
      clientId: "client_123",
      refreshToken: "refresh-token"
    });
  });

  it("does not retry an auth failure after model work has started", async () => {
    const store = createStore({
      credential: {
        kind: "oauth",
        encryptedPayload: encryptPayload({
          access_token: "old-token",
          refresh_token: "refresh-token"
        }, secret),
        expiresAt: new Date("2999-01-01T00:00:00Z")
      }
    });
    const refreshOAuthToken = vi.fn();
    const createModelClient = vi.fn(() => fakeClient([
      { type: "text.delta", delta: "Partial" },
      { type: "error", status: 401, code: "invalid_token", message: "expired" }
    ]));
    const conversationStore = createConversationStore();
    const harness = new AgentHarness({
      store,
      credentialEncryptionKey: secret,
      conversationManager: new ConversationManager({
        store: conversationStore,
        initialTranscriptItemId: 0,
      }),
      refreshOAuthToken,
      createModelClient
    });

    await expect(harness.run({
      providerKey: "openai",
      model: "gpt-test",
      input: "Hi"
    })).rejects.toMatchObject({
      message: "expired",
      status: 401,
      code: "invalid_token"
    });

    expect(createModelClient).toHaveBeenCalledOnce();
    expect(refreshOAuthToken).not.toHaveBeenCalled();
    expect(conversationStore.failedModelCalls).toEqual([{
      conversationId: 42,
      modelCallId: 1,
      responseId: undefined,
      failure: {
        message: "expired",
        status: 401,
        code: "invalid_token",
      },
    }]);
  });

});

type CreateClientInput = {
  provider: ProviderRecord;
  auth: ProviderAuth;
};

function fakeClient(events: ModelStreamEvent[]): ModelClient {
  return {
    async *stream(_request: ModelCallRequest) {
      yield* events;
    },
    close: vi.fn()
  };
}

function createConversationStore() {
  const startedModelCalls: Array<Parameters<ConversationStore["startModelCall"]>[0]> = [];
  const completedModelCalls: Array<Parameters<ConversationStore["completeModelCall"]>[0]> = [];
  const failedModelCalls: Array<Parameters<ConversationStore["failModelCall"]>[0]> = [];

  return {
    startedModelCalls,
    completedModelCalls,
    failedModelCalls,
    async getState(conversationId) {
      return {
        conversationId,
        items: []
      };
    },
    async getMaxTranscriptItemId() {
      return 0;
    },
    async listTranscriptItemsAfterId() {
      return [];
    },
    async listRecentModelCallsWithTranscriptItems() {
      return [];
    },
    async startModelCall(input) {
      startedModelCalls.push(input);

      return {
        conversationId: 42,
        modelCallId: 1,
        modelCall: modelCall({ id: 1, status: "running" }),
        transcriptItems: [],
        requestContext: {
          historyItems: []
        },
        lifecycle: {
          createdConversation: true,
          createdModelCall: true
        }
      };
    },
    async completeModelCall(input) {
      completedModelCalls.push(input);

      return {
        conversationId: input.conversationId,
        previousResponseId: input.responseId,
        items: [],
        modelCall: modelCall({
          id: input.modelCallId,
          conversationId: input.conversationId,
          status: "completed",
          responseId: input.responseId ?? null,
        }),
        transcriptItems: []
      };
    },
    async failModelCall(input) {
      failedModelCalls.push(input);

      return {
        conversationId: input.conversationId,
        items: [],
        modelCall: modelCall({
          id: input.modelCallId,
          conversationId: input.conversationId,
          status: "failed",
          responseId: input.responseId ?? null,
          failureMessage: input.failure?.message ?? null,
          failureCode: input.failure?.code ?? null,
          failureStatus: input.failure?.status ?? null,
        }),
      };
    },
    async abortModelCall(input) {
      return {
        conversationId: input.conversationId,
        items: [],
        modelCall: modelCall({
          id: input.modelCallId,
          conversationId: input.conversationId,
          status: "aborted",
        }),
      };
    },
    async abortRunningModelCalls() {
      return 0;
    }
  } satisfies ConversationStore & {
    startedModelCalls: Array<Parameters<ConversationStore["startModelCall"]>[0]>;
    completedModelCalls: Array<Parameters<ConversationStore["completeModelCall"]>[0]>;
    failedModelCalls: Array<Parameters<ConversationStore["failModelCall"]>[0]>;
  };
}

function modelCall(
  input: Partial<ConversationModelCall> & Pick<ConversationModelCall, "id">,
): ConversationModelCall {
  return {
    id: input.id,
    conversationId: input.conversationId ?? 42,
    providerKey: "openai",
    model: "gpt-test",
    transport: "responses",
    previousResponseId: null,
    responseId: input.responseId ?? null,
    status: input.status ?? "running",
    failureMessage: input.failureMessage ?? null,
    failureCode: input.failureCode ?? null,
    failureStatus: input.failureStatus ?? null,
    usage: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: input.completedAt ?? null,
  };
}

function createStore(input: {
  provider?: Partial<ProviderRecord>;
  credential: Pick<CredentialRecord, "kind" | "encryptedPayload"> & Partial<CredentialRecord>;
}) {
  const provider: ProviderRecord = {
    id: 1,
    key: "openai",
    name: "OpenAI",
    baseUrl: "https://api.example.test/v1",
    ...input.provider
  };

  return {
    getProviderByKey: vi.fn(async (providerKey: string) => provider.key === providerKey ? provider : undefined),
    getActiveCredentialByProviderKey: vi.fn(async () => ({
      id: 1,
      providerId: provider.id,
      label: "OpenAI",
      active: true,
      expiresAt: null,
      ...input.credential
    })),
    getOAuthConfigByProviderKey: vi.fn(async () => ({
      id: 1,
      providerId: provider.id,
      authorizeUrl: "https://auth.example.test/authorize",
      tokenUrl: "https://auth.example.test/token",
      clientId: "client_123",
      scopes: ["openid"],
      extraAuthorizeParams: {},
      redirectUri: "http://localhost/callback"
    })),
    updateCredentialSecret: vi.fn(async (update: {
      credentialId: number;
      encryptedPayload: string;
      expiresAt?: Date | null;
    }) => ({
      id: update.credentialId,
      providerId: provider.id,
      label: "OpenAI",
      active: true,
      kind: input.credential.kind,
      encryptedPayload: update.encryptedPayload,
      expiresAt: update.expiresAt ?? null
    }))
  } as unknown as ProviderAccessStore;
}
