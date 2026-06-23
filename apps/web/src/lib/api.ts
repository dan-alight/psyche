import {
  agentRunRequestSchema,
  agentRunResponseSchema,
  conversationLiveEventSchema,
  conversationRecentModelCallsResponseSchema,
  credentialResponseSchema,
  healthResponseSchema,
  modelResponseSchema,
  oauthStartResponseSchema,
  providerResponseSchema,
  type AgentRunRequest
} from "@psyche/shared";
import { z } from "zod";

async function parseJsonResponse<T>(response: Response, parser: { parse: (value: unknown) => T }) {
  const data: unknown = await response.json();

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
        : "Request failed";
    throw new Error(message);
  }

  return parser.parse(data);
}

export async function getHealth() {
  const response = await fetch("/api/health");
  return parseJsonResponse(response, healthResponseSchema);
}

export async function listProviders() {
  const response = await fetch("/api/providers");
  return parseJsonResponse(response, z.array(providerResponseSchema));
}

export async function listModels(providerId?: number) {
  const url = new URL("/api/models", window.location.origin);

  if (providerId) {
    url.searchParams.set("providerId", String(providerId));
  }

  const response = await fetch(url);
  return parseJsonResponse(response, z.array(modelResponseSchema));
}

export async function listCredentials() {
  const response = await fetch("/api/credentials");
  return parseJsonResponse(response, z.array(credentialResponseSchema));
}

export async function listRecentConversationModelCalls(limit = 20) {
  const url = new URL("/api/conversation/model-calls", window.location.origin);

  url.searchParams.set("limit", String(limit));

  const response = await fetch(url);
  return parseJsonResponse(response, conversationRecentModelCallsResponseSchema);
}

export async function startAgentRun(input: AgentRunRequest) {
  const body = agentRunRequestSchema.parse(input);
  const response = await fetch("/api/agent/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return parseJsonResponse(response, agentRunResponseSchema);
}

export function conversationStreamUrl(afterTranscriptItemId: number) {
  const url = new URL("/api/conversation/stream", window.location.href);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("afterTranscriptItemId", String(afterTranscriptItemId));

  return url.toString();
}

export function parseConversationLiveEvent(data: string) {
  return conversationLiveEventSchema.parse(JSON.parse(data));
}

export async function startOpenAiOAuth() {
  const response = await fetch("/api/auth/oauth/openai/start", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: "{}"
  });

  return parseJsonResponse(response, oauthStartResponseSchema);
}
