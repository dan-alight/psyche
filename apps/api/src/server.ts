import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { env } from "@/env";
import type { AgentHarness } from "@/agents/AgentHarness";
import {
  initializeConversationManager,
  type ConversationManager,
} from "@/conversations/ConversationManager";
import type { ProviderAccessStore } from "@/providerStore";
import { registerAgentRoutes } from "@/routes/agent";
import { registerConversationRoutes } from "@/routes/conversation";
import { registerProviderAccessRoutes } from "@/routes/providerAccess";
import { registerHealthRoutes } from "@/routes/health";

export type BuildServerOptions = {
  agentHarness?: AgentHarness;
  conversationManager?: ConversationManager;
  providerStore?: ProviderAccessStore;
};

export async function buildServer(options: BuildServerOptions = {}) {
  const conversationManager =
    options.conversationManager ?? (await initializeConversationManager());
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN
  });

  await app.register(websocket);
  await app.register(registerHealthRoutes, { prefix: "/api" });
  if (options.agentHarness) {
    await app.register(registerAgentRoutes, {
      prefix: "/api",
      harness: options.agentHarness,
    });
  }
  await app.register(registerConversationRoutes, {
    prefix: "/api",
    manager: conversationManager
  });
  await app.register(registerProviderAccessRoutes, {
    prefix: "/api",
    store: options.providerStore,
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY
  });

  return app;
}
