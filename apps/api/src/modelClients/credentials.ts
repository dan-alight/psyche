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
      openai: removeUndefined({
        organization: parsed.organization,
        project: parsed.project,
      })
    };
  }

  const parsed = oauthCredentialPayloadSchema.parse(payload);

  if (input.forceRefresh || shouldRefresh(credential.expiresAt, now, input.refreshSkewMs ?? defaultRefreshSkewMs)) {
    return refreshActiveOAuthCredential(input, credential.id);
  }

  return oauthPayloadToProviderAuth(parsed);
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

  return oauthPayloadToProviderAuth(mergedPayload);
}

function oauthPayloadToProviderAuth(payload: Record<string, unknown>): ProviderAuth {
  const openAiClaims = openAiAuthClaims(payload);
  const chatgptAccountId =
    stringValue(payload.account_id) ?? openAiClaims.chatgptAccountId;
  const openai = removeUndefined({
    organization: openAiClaims.organization,
    project: openAiClaims.project,
    chatgpt: chatgptAccountId
      ? {
          accountId: chatgptAccountId,
          originator: "psyche",
          beta: "responses=experimental",
        }
      : undefined,
  });

  return removeUndefined({
    bearerToken: String(payload.access_token),
    openai: hasEntries(openai) ? openai : undefined,
  });
}

function openAiAuthClaims(payload: Record<string, unknown>) {
  return {
    chatgptAccountId:
      openAiAuthClaim(payload.access_token, "chatgpt_account_id") ??
      openAiAuthClaim(payload.id_token, "chatgpt_account_id"),
    organization:
      openAiAuthClaim(payload.access_token, "organization_id") ??
      openAiAuthClaim(payload.id_token, "organization_id"),
    project:
      openAiAuthClaim(payload.access_token, "project_id") ??
      openAiAuthClaim(payload.id_token, "project_id"),
  };
}

function openAiAuthClaim(token: unknown, key: string) {
  const payload = jwtPayload(token);
  const auth = isRecord(payload)
    ? payload["https://api.openai.com/auth"]
    : undefined;

  return isRecord(auth) ? stringValue(auth[key]) : undefined;
}

function jwtPayload(token: unknown) {
  if (typeof token !== "string") {
    return undefined;
  }

  const [, payload] = token.split(".");

  if (!payload) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as T;
}

function hasEntries(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

function isExpired(expiresAt: Date | null, now: Date) {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

function shouldRefresh(expiresAt: Date | null, now: Date, refreshSkewMs: number) {
  return !!expiresAt && expiresAt.getTime() - now.getTime() <= refreshSkewMs;
}
