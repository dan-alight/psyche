import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  credentialCreateRequestSchema,
  credentialActivateParamsSchema,
  modelCreateRequestSchema,
  oauthCallbackQuerySchema,
  oauthCompleteRequestSchema,
  oauthConfigCreateRequestSchema,
  providerCreateRequestSchema
} from "@psyche/shared";

import { encryptPayload } from "@/credentialCrypto";
import {
  buildOAuthAuthorizeUrl,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
  exchangeOAuthCode,
  type OAuthCodeExchangeInput
} from "@/providerOAuth";
import { createDrizzleProviderAccessStore, type ProviderAccessStore } from "@/providerStore";

export type OAuthCodeExchangeResult = {
  payload: unknown;
  expiresAt?: Date;
};

export type ProviderAccessRouteOptions = {
  store?: ProviderAccessStore;
  credentialEncryptionKey: string;
  exchangeOAuthCode?: (input: OAuthCodeExchangeInput) => Promise<OAuthCodeExchangeResult>;
};

export async function registerProviderAccessRoutes(app: FastifyInstance, options: ProviderAccessRouteOptions) {
  const store = options.store ?? createDrizzleProviderAccessStore();
  const oauthSessions = new Map<string, {
    codeVerifier: string;
    redirectUri: string;
    expiresAt: Date;
  }>();

  function oauthSessionKey(providerKey: string, state: string) {
    return `${providerKey}:${state}`;
  }

  async function finishOAuthCredential(input: {
    providerKey: string;
    code: string;
    state: string;
    label?: string;
  }) {
    const config = await store.getOAuthConfigByProviderKey(input.providerKey);

    if (!config) {
      return { statusCode: 404, body: { message: "OAuth config not found" } };
    }

    const sessionKey = oauthSessionKey(input.providerKey, input.state);
    const session = oauthSessions.get(sessionKey);
    oauthSessions.delete(sessionKey);

    if (!session || session.expiresAt.getTime() < Date.now()) {
      return { statusCode: 400, body: { message: "OAuth session not found or expired" } };
    }

    const exchanged = await (options.exchangeOAuthCode ?? exchangeOAuthCode)({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      redirectUri: session.redirectUri,
      code: input.code,
      codeVerifier: session.codeVerifier
    });
    const created = await store.createCredential({
      providerId: config.providerId,
      label: input.label ?? `${input.providerKey} OAuth`,
      kind: "oauth",
      encryptedPayload: encryptPayload(exchanged.payload, options.credentialEncryptionKey),
      expiresAt: exchanged.expiresAt
    });
    const { encryptedPayload: _encryptedPayload, ...publicCredential } = created;

    return { statusCode: 201, body: publicCredential };
  }

  app.get("/providers", async () => store.listProviders());

  app.post("/providers", async (request, reply) => {
    const body = providerCreateRequestSchema.parse(request.body);
    const created = await store.createProvider(body);

    return reply.code(201).send(created);
  });

  app.get("/models", async (request) => {
    const query = z.object({ providerId: z.coerce.number().int().positive().optional() }).parse(request.query);
    return store.listModels(query.providerId);
  });

  app.post("/models", async (request, reply) => {
    const body = modelCreateRequestSchema.parse(request.body);
    const created = await store.createModel(body);

    return reply.code(201).send(created);
  });

  app.get("/credentials", async (request) => {
    const query = z.object({ providerId: z.coerce.number().int().positive().optional() }).parse(request.query);
    return store.listCredentials(query.providerId);
  });

  app.post("/credentials", async (request, reply) => {
    const body = credentialCreateRequestSchema.parse(request.body);
    const created = await store.createCredential({
      providerId: body.providerId,
      label: body.label,
      kind: body.kind,
      encryptedPayload: encryptPayload(body.payload, options.credentialEncryptionKey),
      expiresAt: body.expiresAt,
      active: body.active ?? false
    });
    const { encryptedPayload: _encryptedPayload, ...publicCredential } = created;

    return reply.code(201).send(publicCredential);
  });

  app.patch("/credentials/:credentialId/active", async (request, reply) => {
    const params = credentialActivateParamsSchema.parse(request.params);
    const activated = await store.activateCredential(params.credentialId);

    if (!activated) {
      return reply.code(404).send({ message: "Credential not found" });
    }

    return activated;
  });

  app.post("/oauth-configs", async (request, reply) => {
    const body = oauthConfigCreateRequestSchema.parse(request.body);
    const created = await store.createOAuthConfig(body);

    return reply.code(201).send(created);
  });

  app.post("/auth/oauth/:providerKey/start", async (request, reply) => {
    const params = z.object({ providerKey: z.string().min(1) }).parse(request.params);
    const config = await store.getOAuthConfigByProviderKey(params.providerKey);

    if (!config) {
      return reply.code(404).send({ message: "OAuth config not found" });
    }

    const state = createOAuthState();
    const codeVerifier = createPkceVerifier();
    const codeChallenge = createPkceChallenge(codeVerifier);
    oauthSessions.set(oauthSessionKey(params.providerKey, state), {
      codeVerifier,
      redirectUri: config.redirectUri,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });
    const authorizeUrl = buildOAuthAuthorizeUrl({
      authorizeUrl: config.authorizeUrl,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
      codeChallenge,
      extraAuthorizeParams: config.extraAuthorizeParams
    });

    return {
      providerKey: params.providerKey,
      authorizeUrl: authorizeUrl.toString(),
      state
    };
  });

  app.post("/auth/oauth/:providerKey/complete", async (request, reply) => {
    const params = z.object({ providerKey: z.string().min(1) }).parse(request.params);
    const body = oauthCompleteRequestSchema.parse(request.body);
    const result = await finishOAuthCredential({
      providerKey: params.providerKey,
      code: body.code,
      state: body.state,
      label: body.label
    });

    return reply.code(result.statusCode).send(result.body);
  });

  app.get("/auth/oauth/:providerKey/callback", async (request, reply) => {
    const params = z.object({ providerKey: z.string().min(1) }).parse(request.params);
    const query = oauthCallbackQuerySchema.parse(request.query);
    const result = await finishOAuthCredential({
      providerKey: params.providerKey,
      code: query.code,
      state: query.state
    });

    return reply.code(result.statusCode).send(result.body);
  });
}
