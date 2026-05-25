import cors from "@fastify/cors";
import Fastify from "fastify";

import { env } from "@/env";
import { registerProviderAccessRoutes } from "@/routes/providerAccess";
import { registerHealthRoutes } from "@/routes/health";

export async function buildServer() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN
  });

  await app.register(registerHealthRoutes, { prefix: "/api" });
  await app.register(registerProviderAccessRoutes, {
    prefix: "/api",
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY
  });

  return app;
}
