import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AgentHarness } from "@/agents/AgentHarness";
import { registerAgentRoutes } from "@/routes/agent";

describe("agent routes", () => {
  it("starts an agent run through the harness", async () => {
    const harness = {
      run: vi.fn(async () => undefined),
    } as unknown as AgentHarness;
    const app = Fastify({ logger: false });

    await app.register(registerAgentRoutes, { harness });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/agent/runs",
      payload: {
        providerKey: "openai",
        model: "gpt-test",
        input: "Hi",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "completed" });
    expect(harness.run).toHaveBeenCalledWith({
      providerKey: "openai",
      model: "gpt-test",
      input: "Hi",
    });

    await app.close();
  });
});
