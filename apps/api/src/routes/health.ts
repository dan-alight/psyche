import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@psyche/shared";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get<{ Reply: HealthResponse }>("/health", async () => ({
    ok: true,
    service: "psyche-api"
  }));
}
