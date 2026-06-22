import {
  credentialResponseSchema,
  healthResponseSchema,
  oauthStartResponseSchema,
  providerResponseSchema
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

export async function listCredentials() {
  const response = await fetch("/api/credentials");
  return parseJsonResponse(response, z.array(credentialResponseSchema));
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
