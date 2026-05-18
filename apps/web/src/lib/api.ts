import { healthResponseSchema } from "@psyche/shared";

async function parseJsonResponse<T>(response: Response, parser: { parse: (value: unknown) => T }) {
  const data: unknown = await response.json();

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Request failed";
    throw new Error(message);
  }

  return parser.parse(data);
}

export async function getHealth() {
  const response = await fetch("/api/health");
  return parseJsonResponse(response, healthResponseSchema);
}
