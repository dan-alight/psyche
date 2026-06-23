import { z } from "zod";

export const agentRunRequestSchema = z.object({
  providerKey: z.string().min(1),
  model: z.string().min(1),
  input: z.string().min(1),
});

export const agentRunResponseSchema = z.object({
  status: z.literal("completed"),
});

export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;
export type AgentRunResponse = z.infer<typeof agentRunResponseSchema>;
