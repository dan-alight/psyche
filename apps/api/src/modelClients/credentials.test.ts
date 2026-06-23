import { describe, expect, it, vi } from "vitest";

import { decryptPayload, encryptPayload } from "@/credentialCrypto";
import { resolveActiveProviderAuth } from "@/modelClients/credentials";
import type { CredentialRecord, ProviderAccessStore } from "@/providerStore";

const secret = "test-credential-secret";

describe("resolveActiveProviderAuth", () => {
  it("returns bearer auth from the active API key credential", async () => {
    const store = createStore({
      kind: "api_key",
      encryptedPayload: encryptPayload({
        apiKey: "sk-test",
        organization: "org_123",
        project: "proj_123"
      }, secret)
    });

    await expect(resolveActiveProviderAuth({
      store,
      providerKey: "openai",
      credentialEncryptionKey: secret
    })).resolves.toEqual({
      bearerToken: "sk-test",
      openai: {
        organization: "org_123",
        project: "proj_123"
      }
    });
  });

  it("refreshes an expiring OAuth credential and persists the new encrypted payload", async () => {
    const store = createStore({
      kind: "oauth",
      encryptedPayload: encryptPayload({
        access_token: "old-token",
        refresh_token: "refresh-token",
        token_type: "bearer"
      }, secret),
      expiresAt: new Date("2026-01-02T00:04:00Z")
    });
    const refreshOAuthToken = vi.fn(async () => ({
      payload: {
        access_token: "new-token",
        token_type: "bearer"
      },
      expiresAt: new Date("2026-01-02T01:00:00Z")
    }));

    await expect(resolveActiveProviderAuth({
      store,
      providerKey: "openai",
      credentialEncryptionKey: secret,
      now: new Date("2026-01-02T00:00:00Z"),
      refreshOAuthToken
    })).resolves.toEqual({
      bearerToken: "new-token"
    });

    expect(refreshOAuthToken).toHaveBeenCalledWith({
      tokenUrl: "https://auth.example.test/token",
      clientId: "client_123",
      refreshToken: "refresh-token"
    });
    expect(store.updateCredentialSecret).toHaveBeenCalledOnce();

    const update = vi.mocked(store.updateCredentialSecret).mock.calls[0]![0];
    expect(update.credentialId).toBe(1);
    expect(update.expiresAt).toEqual(new Date("2026-01-02T01:00:00Z"));
    expect(decryptPayload(update.encryptedPayload, secret)).toEqual({
      access_token: "new-token",
      refresh_token: "refresh-token",
      token_type: "bearer"
    });
  });

  it("returns ChatGPT account auth from OAuth JWT claims", async () => {
    const store = createStore({
      kind: "oauth",
      encryptedPayload: encryptPayload({
        access_token: jwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "account_123",
            organization_id: "org_123",
            project_id: "proj_123"
          }
        }),
        refresh_token: "refresh-token"
      }, secret),
      expiresAt: new Date("2999-01-01T00:00:00Z")
    });

    await expect(resolveActiveProviderAuth({
      store,
      providerKey: "openai",
      credentialEncryptionKey: secret
    })).resolves.toEqual({
      bearerToken: jwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account_123",
          organization_id: "org_123",
          project_id: "proj_123"
        }
      }),
      openai: {
        organization: "org_123",
        project: "proj_123",
        chatgpt: {
          accountId: "account_123",
          originator: "psyche",
          beta: "responses=experimental"
        }
      }
    });
  });

  it("rejects an expired OAuth credential without a refresh token", async () => {
    const store = createStore({
      kind: "oauth",
      encryptedPayload: encryptPayload({ access_token: "oauth-token" }, secret),
      expiresAt: new Date("2026-01-01T00:00:00Z")
    });

    await expect(resolveActiveProviderAuth({
      store,
      providerKey: "openai",
      credentialEncryptionKey: secret,
      now: new Date("2026-01-02T00:00:00Z")
    })).rejects.toThrow("requires reauth");
  });

  it("deduplicates simultaneous OAuth refreshes for the same credential", async () => {
    const store = createStore({
      kind: "oauth",
      encryptedPayload: encryptPayload({
        access_token: "old-token",
        refresh_token: "refresh-token"
      }, secret),
      expiresAt: new Date("2026-01-01T00:00:00Z")
    });
    const refreshOAuthToken = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));

      return {
        payload: { access_token: "new-token" },
        expiresAt: new Date("2026-01-02T01:00:00Z")
      };
    });
    const input = {
      store,
      providerKey: "openai",
      credentialEncryptionKey: secret,
      now: new Date("2026-01-02T00:00:00Z"),
      refreshOAuthToken
    };

    await expect(Promise.all([
      resolveActiveProviderAuth(input),
      resolveActiveProviderAuth(input)
    ])).resolves.toEqual([
      { bearerToken: "new-token" },
      { bearerToken: "new-token" }
    ]);

    expect(refreshOAuthToken).toHaveBeenCalledOnce();
  });
});

function createStore(credential: Pick<CredentialRecord, "kind" | "encryptedPayload"> & Partial<CredentialRecord> | undefined) {
  return {
    getActiveCredentialByProviderKey: vi.fn(async () => credential
      ? {
          id: 1,
          providerId: 1,
          label: "OpenAI",
          active: true,
          expiresAt: null,
          ...credential
        }
      : undefined),
    getOAuthConfigByProviderKey: vi.fn(async () => ({
      id: 1,
      providerId: 1,
      authorizeUrl: "https://auth.example.test/authorize",
      tokenUrl: "https://auth.example.test/token",
      clientId: "client_123",
      scopes: ["openid"],
      extraAuthorizeParams: {},
      redirectUri: "http://localhost/callback"
    })),
    updateCredentialSecret: vi.fn(async (input: {
      credentialId: number;
      encryptedPayload: string;
      expiresAt?: Date | null;
    }) => credential
      ? {
          id: input.credentialId,
          providerId: 1,
          label: "OpenAI",
          kind: credential.kind,
          active: true,
          encryptedPayload: input.encryptedPayload,
          expiresAt: input.expiresAt ?? null
        }
      : undefined)
  } as unknown as ProviderAccessStore;
}

function jwt(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature"
  ].join(".");
}
