import { z } from "zod";

export const credentialKindSchema = z.enum(["api_key", "oauth"]);

export const providerCreateRequestSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url()
});

export const modelCreateRequestSchema = z.object({
  providerId: z.number().int().positive(),
  modelId: z.string().min(1),
  name: z.string().min(1)
});

export const credentialCreateRequestSchema = z.object({
  providerId: z.number().int().positive(),
  label: z.string().min(1),
  kind: credentialKindSchema,
  payload: z.unknown(),
  expiresAt: z.coerce.date().optional()
});

export const oauthConfigCreateRequestSchema = z.object({
  providerId: z.number().int().positive(),
  authorizeUrl: z.string().url(),
  tokenUrl: z.string().url(),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  extraAuthorizeParams: z.record(z.string()),
  redirectUri: z.string().url()
});

export const oauthCompleteRequestSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  label: z.string().min(1).optional()
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export type ProviderCreateRequest = z.infer<typeof providerCreateRequestSchema>;
export type ModelCreateRequest = z.infer<typeof modelCreateRequestSchema>;
export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>;
export type OAuthConfigCreateRequest = z.infer<typeof oauthConfigCreateRequestSchema>;
export type OAuthCompleteRequest = z.infer<typeof oauthCompleteRequestSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
