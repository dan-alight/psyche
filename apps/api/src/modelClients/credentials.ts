import { apiKeyCredentialPayloadSchema, oauthCredentialPayloadSchema } from "@psyche/shared";

import { decryptPayload, encryptPayload } from "@/credentialCrypto";
import type { ProviderAuth } from "@/modelClients/types";
import { refreshOAuthToken, type OAuthRefreshInput, type OAuthTokenResult } from "@/providerOAuth";
import type { ProviderAccessStore } from "@/providerStore";

const defaultRefreshSkewMs = 5 * 60 * 1000;
const refreshLocks = new Map<number, Promise<ProviderAuth>>();

export type ResolveActiveProviderAuthInput = {
  store: ProviderAccessStore;
  providerKey: string;
  credentialEncryptionKey: string;
  now?: Date;
  refreshSkewMs?: number;
  forceRefresh?: boolean;
  refreshOAuthToken?: (input: OAuthRefreshInput) => Promise<OAuthTokenResult>;
};

export async function resolveActiveProviderAuth(input: ResolveActiveProviderAuthInput): Promise<ProviderAuth> {
  const credential = await input.store.getActiveCredentialByProviderKey(input.providerKey);

  if (!credential) {
    throw new Error(`No active credential configured for provider '${input.providerKey}'`);
  }

  const now = input.now ?? new Date();
  const payload = decryptPayload<unknown>(credential.encryptedPayload, input.credentialEncryptionKey);

  if (credential.kind === "api_key") {
    if (isExpired(credential.expiresAt, now)) {
      throw new Error(`Active API key credential for provider '${input.providerKey}' has expired`);
    }

    const parsed = apiKeyCredentialPayloadSchema.parse(payload);

    return {
      bearerToken: parsed.apiKey,
      organization: parsed.organization,
      project: parsed.project
    };
  }

  const parsed = oauthCredentialPayloadSchema.parse(payload);

  if (input.forceRefresh || shouldRefresh(credential.expiresAt, now, input.refreshSkewMs ?? defaultRefreshSkewMs)) {
    return refreshActiveOAuthCredential(input, credential.id);
  }

  return {
    bearerToken: parsed.access_token
  };
}

async function refreshActiveOAuthCredential(input: ResolveActiveProviderAuthInput, credentialId: number) {
  const existing = refreshLocks.get(credentialId);

  if (existing) {
    return existing;
  }

  const refreshPromise = refreshActiveOAuthCredentialUnlocked(input, credentialId)
    .finally(() => refreshLocks.delete(credentialId));

  refreshLocks.set(credentialId, refreshPromise);

  return refreshPromise;
}

async function refreshActiveOAuthCredentialUnlocked(input: ResolveActiveProviderAuthInput, credentialId: number) {
  const credential = await input.store.getActiveCredentialByProviderKey(input.providerKey);

  if (!credential) {
    throw new Error(`No active credential configured for provider '${input.providerKey}'`);
  }

  if (credential.id !== credentialId || credential.kind !== "oauth") {
    throw new Error(`Active credential for provider '${input.providerKey}' changed during refresh`);
  }

  const now = input.now ?? new Date();
  const payload = oauthCredentialPayloadSchema.parse(
    decryptPayload<unknown>(credential.encryptedPayload, input.credentialEncryptionKey)
  );

  if (!input.forceRefresh && !shouldRefresh(credential.expiresAt, now, input.refreshSkewMs ?? defaultRefreshSkewMs)) {
    return {
      bearerToken: payload.access_token
    };
  }

  if (!payload.refresh_token) {
    throw new Error(`Active OAuth credential for provider '${input.providerKey}' has expired and requires reauth`);
  }

  const oauthConfig = await input.store.getOAuthConfigByProviderKey(input.providerKey);

  if (!oauthConfig) {
    throw new Error(`OAuth config not found for provider '${input.providerKey}'`);
  }

  const refreshed = await (input.refreshOAuthToken ?? refreshOAuthToken)({
    tokenUrl: oauthConfig.tokenUrl,
    clientId: oauthConfig.clientId,
    refreshToken: payload.refresh_token
  });
  const refreshedPayload = oauthCredentialPayloadSchema.parse(refreshed.payload);
  const mergedPayload = {
    ...payload,
    ...refreshedPayload,
    refresh_token: refreshedPayload.refresh_token ?? payload.refresh_token
  };
  const updated = await input.store.updateCredentialSecret({
    credentialId: credential.id,
    encryptedPayload: encryptPayload(mergedPayload, input.credentialEncryptionKey),
    expiresAt: refreshed.expiresAt ?? null
  });

  if (!updated) {
    throw new Error(`Active credential for provider '${input.providerKey}' was not found during refresh`);
  }

  return {
    bearerToken: mergedPayload.access_token
  };
}

function isExpired(expiresAt: Date | null, now: Date) {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

function shouldRefresh(expiresAt: Date | null, now: Date, refreshSkewMs: number) {
  return !!expiresAt && expiresAt.getTime() - now.getTime() <= refreshSkewMs;
}
