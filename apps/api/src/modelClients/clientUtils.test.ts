import { describe, expect, it } from "vitest";

import { providerHeaders } from "@/modelClients/clientUtils";

describe("providerHeaders", () => {
  it("includes ChatGPT account id for OAuth-backed OpenAI requests", () => {
    expect(providerHeaders({
      bearerToken: "token",
      openai: {
        chatgpt: {
          accountId: "account_123",
          originator: "psyche",
          beta: "responses=experimental",
        },
      },
    })).toMatchObject({
      Authorization: "Bearer token",
      "chatgpt-account-id": "account_123",
      originator: "psyche",
      "OpenAI-Beta": "responses=experimental",
    });
  });
});
