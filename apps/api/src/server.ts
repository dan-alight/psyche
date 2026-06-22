import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { env } from "@/env";
import {
  initializeConversationManager,
  type ConversationManager,
} from "@/conversations/ConversationManager";
import { registerConversationRoutes } from "@/routes/conversation";
import { registerProviderAccessRoutes } from "@/routes/providerAccess";
import { registerHealthRoutes } from "@/routes/health";

export type BuildServerOptions = {
  conversationManager?: ConversationManager;
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
  await app.register(registerConversationRoutes, {
    prefix: "/api",
    manager: conversationManager
  });
  await app.register(registerProviderAccessRoutes, {
    prefix: "/api",
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY
  });

  return app;
}
