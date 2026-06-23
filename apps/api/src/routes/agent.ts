import type { FastifyInstance } from "fastify";
import { agentRunRequestSchema } from "@psyche/shared";

import type { AgentHarness } from "@/agents/AgentHarness";

export type AgentRouteOptions = {
  harness: AgentHarness;
};

export async function registerAgentRoutes(
  app: FastifyInstance,
  options: AgentRouteOptions,
) {
  app.post("/agent/runs", async (request) => {
    const body = agentRunRequestSchema.parse(request.body);

    await options.harness.run(body);

    return { status: "completed" as const };
  });
}
