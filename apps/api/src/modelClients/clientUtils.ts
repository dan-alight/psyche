import type { ProviderAuth } from "@/modelClients/types";

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function providerHeaders(
  auth: ProviderAuth,
  options: { contentType?: boolean } = {},
) {
  return {
    Authorization: `Bearer ${auth.bearerToken}`,
    ...(options.contentType ? { "Content-Type": "application/json" } : {}),
    ...optionalHeader("OpenAI-Organization", auth.organization),
    ...optionalHeader("OpenAI-Project", auth.project),
  };
}

export function parseJsonRecord(
  value: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalHeader(name: string, value: string | undefined) {
  return value ? { [name]: value } : {};
}
