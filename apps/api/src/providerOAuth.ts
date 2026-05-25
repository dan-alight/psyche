import { createHash, randomBytes } from "node:crypto";

export type OAuthAuthorizeUrlInput = {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  extraAuthorizeParams: Record<string, string>;
};

export type OAuthCodeExchangeInput = {
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
};

export function createPkceVerifier() {
  return randomBytes(32).toString("base64url");
}

export function createPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOAuthState() {
  return randomBytes(24).toString("base64url");
}

export function buildOAuthAuthorizeUrl(input: OAuthAuthorizeUrlInput) {
  const url = new URL(input.authorizeUrl);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  for (const [key, value] of Object.entries(input.extraAuthorizeParams)) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function exchangeOAuthCode(input: OAuthCodeExchangeInput) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier
  });

  const response = await fetch(input.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with status ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;

  return {
    payload,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined
  };
}
