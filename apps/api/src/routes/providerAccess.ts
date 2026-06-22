import type { FastifyInstance, FastifyReply } from "fastify";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
import { env } from "@/env";

type LocalOAuthCallbackServer = {
  server: Server;
  redirectUrl: URL;
};

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
  const oauthStateProviders = new Map<string, string>();
  const localOAuthCallbackServers = new Map<string, Promise<LocalOAuthCallbackServer>>();

  app.addHook("onClose", async () => {
    const callbackServers = await Promise.allSettled(localOAuthCallbackServers.values());
    await Promise.all(callbackServers.flatMap((result) => {
      if (result.status !== "fulfilled") {
        return [];
      }

      return closeServer(result.value.server);
    }));
  });

  function oauthSessionKey(providerKey: string, state: string) {
    return `${providerKey}:${state}`;
  }

  function closeServer(server: Server) {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async function ensureLocalOAuthCallbackServer(redirectUri: string) {
    const redirectUrl = localOAuthCallbackUrl(redirectUri);

    if (!redirectUrl) {
      return;
    }

    const key = localOAuthCallbackServerKey(redirectUrl);
    let callbackServer = localOAuthCallbackServers.get(key);

    if (!callbackServer) {
      callbackServer = listenForLocalOAuthCallback(redirectUrl);
      localOAuthCallbackServers.set(key, callbackServer);
    }

    await callbackServer;
  }

  function localOAuthCallbackUrl(redirectUri: string) {
    const redirectUrl = new URL(redirectUri);
    const isHttpLoopback =
      redirectUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(redirectUrl.hostname);

    if (!isHttpLoopback) {
      return undefined;
    }

    if (!redirectUrl.port) {
      throw new Error("Loopback OAuth redirect URI must include an explicit port");
    }

    return redirectUrl;
  }

  function localOAuthCallbackServerKey(redirectUrl: URL) {
    return `${redirectUrl.protocol}//${redirectUrl.hostname}:${redirectUrl.port}`;
  }

  async function listenForLocalOAuthCallback(redirectUrl: URL): Promise<LocalOAuthCallbackServer> {
    const server = createServer((request, response) => {
      void handleLocalOAuthCallbackRequest(request, response, redirectUrl);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(redirectUrl.port), redirectUrl.hostname, () => {
        server.off("error", reject);
        resolve();
      });
    });

    return { server, redirectUrl };
  }

  async function handleLocalOAuthCallbackRequest(
    request: IncomingMessage,
    response: ServerResponse,
    redirectUrl: URL
  ) {
    const requestUrl = new URL(request.url ?? "/", redirectUrl.origin);

    if (request.method !== "GET" || requestUrl.pathname !== redirectUrl.pathname) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }

    const query = Object.fromEntries(requestUrl.searchParams.entries());
    const returnUrl = await completeOAuthCallbackToWeb(query, oauthProviderKeyForQuery(query) ?? "unknown");

    response.writeHead(303, {
      connection: "close",
      location: returnUrl
    });
    response.end();
  }

  function webOAuthReturnUrl(input: {
    providerKey: string;
    status: "connected" | "error";
    message?: string;
  }) {
    const url = new URL("/settings", env.WEB_ORIGIN);
    url.searchParams.set("oauth", input.providerKey);
    url.searchParams.set("status", input.status);

    if (input.message) {
      url.searchParams.set("message", input.message);
    }

    return url.toString();
  }

  function oauthProviderKeyForQuery(query: unknown) {
    if (!query || typeof query !== "object") {
      return undefined;
    }

    const state = (query as Record<string, unknown>).state;

    return typeof state === "string" ? oauthStateProviders.get(state) : undefined;
  }

  function callbackErrorMessage(query: unknown) {
    if (!query || typeof query !== "object") {
      return "OAuth callback was incomplete";
    }

    const errorQuery = query as Record<string, unknown>;
    const description = errorQuery.error_description;
    const error = errorQuery.error;

    return typeof description === "string"
      ? description
      : typeof error === "string"
        ? error
        : "OAuth callback was incomplete";
  }

  function redirectToWebOAuthReturn(reply: FastifyReply, url: string) {
    return reply.code(303).header("location", url).send();
  }

  async function completeOAuthCallbackToWeb(queryInput: unknown, providerKey: string) {
    const query = oauthCallbackQuerySchema.safeParse(queryInput);

    if (!query.success) {
      return webOAuthReturnUrl({
        providerKey,
        status: "error",
        message: callbackErrorMessage(queryInput)
      });
    }

    const result = await finishOAuthCredential({
      providerKey,
      code: query.data.code,
      state: query.data.state
    });
    const message =
      result.body && typeof result.body === "object" && "message" in result.body && typeof result.body.message === "string"
        ? result.body.message
        : undefined;

    return webOAuthReturnUrl({
      providerKey,
      status: result.statusCode >= 200 && result.statusCode < 300 ? "connected" : "error",
      message
    });
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
    oauthStateProviders.delete(input.state);

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
      expiresAt: exchanged.expiresAt,
      active: true
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

    await ensureLocalOAuthCallbackServer(config.redirectUri);

    oauthSessions.set(oauthSessionKey(params.providerKey, state), {
      codeVerifier,
      redirectUri: config.redirectUri,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });
    oauthStateProviders.set(state, params.providerKey);
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
    return redirectToWebOAuthReturn(reply, await completeOAuthCallbackToWeb(request.query, params.providerKey));
  });
}
