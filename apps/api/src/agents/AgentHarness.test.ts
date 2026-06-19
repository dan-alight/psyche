import { describe, expect, it, vi } from "vitest";

import { AgentHarness } from "@/agents/AgentHarness";
import type { ConversationStore } from "@/modelClients/conversationStore";
import type { ModelCallRequest, ModelClient, ModelStreamEvent, ProviderAuth } from "@/modelClients/types";
import { encryptPayload } from "@/credentialCrypto";
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
      { type: "conversation.created", conversationId: 42 },
      { type: "response.completed", id: "resp_1", outputText: "Hello" }
    ]));
    const harness = new AgentHarness({
      store,
      credentialEncryptionKey: secret,
      conversationStore: createConversationStore(),
      createModelClient
    });

    const events = await collect(harness.run({
      providerKey: "openai",
      model: "gpt-test",
      input: [{ type: "message", role: "user", content: "Hi" }]
    }));

    expect(createModelClient).toHaveBeenCalledOnce();
    expect(createModelClient.mock.calls[0]![0]).toMatchObject({
      auth: { bearerToken: "sk-test" },
      provider: { key: "openai", baseUrl: "https://api.example.test/v1" }
    });
    expect(events).toEqual([
      { type: "run.started", providerKey: "openai", model: "gpt-test", conversationId: undefined },
      { type: "response.created", id: "resp_1" },
      { type: "text.delta", delta: "Hello" },
      { type: "conversation.created", conversationId: 42 },
      { type: "response.completed", id: "resp_1", outputText: "Hello" },
      { type: "run.completed", conversationId: 42, responseId: "resp_1" }
    ]);
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
    const harness = new AgentHarness({
      store,
      credentialEncryptionKey: secret,
      conversationStore: createConversationStore(),
      refreshOAuthToken,
      createModelClient
    });

    const events = await collect(harness.run({
      providerKey: "openai",
      model: "gpt-test",
      input: [{ type: "message", role: "user", content: "Hi" }]
    }));

    expect(tokens).toEqual(["old-token", "new-token"]);
    expect(refreshOAuthToken).toHaveBeenCalledWith({
      tokenUrl: "https://auth.example.test/token",
      clientId: "client_123",
      refreshToken: "refresh-token"
    });
    expect(events).toEqual([
      { type: "run.started", providerKey: "openai", model: "gpt-test", conversationId: undefined },
      { type: "response.created", id: "resp_retry" },
      { type: "text.delta", delta: "Recovered" },
      { type: "response.completed", id: "resp_retry", outputText: "Recovered" },
      { type: "run.completed", conversationId: undefined, responseId: "resp_retry" }
    ]);
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
    const harness = new AgentHarness({
      store,
      credentialEncryptionKey: secret,
      conversationStore: createConversationStore(),
      refreshOAuthToken,
      createModelClient
    });

    const events = await collect(harness.run({
      providerKey: "openai",
      model: "gpt-test",
      input: [{ type: "message", role: "user", content: "Hi" }]
    }));

    expect(createModelClient).toHaveBeenCalledOnce();
    expect(refreshOAuthToken).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "run.started", providerKey: "openai", model: "gpt-test", conversationId: undefined },
      { type: "text.delta", delta: "Partial" },
      { type: "error", status: 401, code: "invalid_token", message: "expired" },
      { type: "run.failed", status: 401, code: "invalid_token", message: "expired" }
    ]);
  });
});

type CreateClientInput = {
  provider: ProviderRecord;
  auth: ProviderAuth;
  conversationStore: ConversationStore;
};

function fakeClient(events: ModelStreamEvent[]): ModelClient {
  return {
    async *stream(_request: ModelCallRequest) {
      yield* events;
    },
    close: vi.fn()
  };
}

function createConversationStore(): ConversationStore {
  return {
    async getState(conversationId, _providerKey) {
      return {
        conversationId,
        items: []
      };
    },
    async appendModelCall(input) {
      return {
        conversationId: input.conversationId ?? 1,
        previousResponseId: input.responseId,
        items: []
      };
    }
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

async function collect(stream: AsyncIterable<unknown>) {
  const events: unknown[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  return events;
}

