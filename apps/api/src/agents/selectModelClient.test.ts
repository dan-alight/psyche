import { describe, expect, it } from "vitest";

import {
  createTurnModelClient,
  toCodexOAuthRequest,
} from "@/agents/selectModelClient";
import type { ProviderRecord } from "@/providerStore";

describe("createTurnModelClient", () => {
  it("uses the Codex backend for OpenAI ChatGPT OAuth credentials", () => {
    const client = createTurnModelClient({
      provider: providerRecord({
        key: "openai",
        baseUrl: "https://api.openai.com/v1",
      }),
      auth: {
        bearerToken: "token",
        openai: {
          chatgpt: {
            accountId: "account_123",
            originator: "psyche",
            beta: "responses=experimental",
          },
        },
      },
    });

    expect(client).toMatchObject({
      client: {
        options: {
          baseUrl: "https://chatgpt.com/backend-api/codex",
        },
      },
    });
  });

  it("adds Codex OAuth request defaults required by the backend", () => {
    expect(toCodexOAuthRequest({
      historyItems: [],
      model: "gpt-test",
      input: [{ type: "message", role: "user", content: "Hi" }],
    })).toMatchObject({
      instructions: "You are a helpful assistant.",
      store: false,
    });
  });

  it("preserves explicit Codex OAuth request instructions and store mode", () => {
    expect(toCodexOAuthRequest({
      historyItems: [],
      model: "gpt-test",
      instructions: "Custom instructions",
      store: true,
      input: [{ type: "message", role: "user", content: "Hi" }],
    })).toMatchObject({
      instructions: "Custom instructions",
      store: true,
    });
  });
});

function providerRecord(input: Partial<ProviderRecord>): ProviderRecord {
  return {
    id: 1,
    key: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    ...input,
  };
}
