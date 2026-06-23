import { z } from "zod";

export const credentialKindSchema = z.enum(["api_key", "oauth"]);

export const apiKeyCredentialPayloadSchema = z.object({
  apiKey: z.string().min(1),
  organization: z.string().min(1).optional(),
  project: z.string().min(1).optional()
});

export const oauthCredentialPayloadSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  id_token: z.string().min(1).optional(),
  account_id: z.string().min(1).optional()
}).passthrough();

export const providerCreateRequestSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url()
});

export const providerResponseSchema = providerCreateRequestSchema.extend({
  id: z.number().int().positive()
});

export const modelCreateRequestSchema = z.object({
  providerId: z.number().int().positive(),
  modelId: z.string().min(1),
  name: z.string().min(1)
});

export const modelResponseSchema = modelCreateRequestSchema.extend({
  id: z.number().int().positive()
});

const credentialCreateBaseSchema = z.object({
  providerId: z.number().int().positive(),
  label: z.string().min(1),
  expiresAt: z.coerce.date().optional(),
  active: z.boolean().optional()
});

export const credentialCreateRequestSchema = z.discriminatedUnion("kind", [
  credentialCreateBaseSchema.extend({
    kind: z.literal("api_key"),
    payload: apiKeyCredentialPayloadSchema
  }),
  credentialCreateBaseSchema.extend({
    kind: z.literal("oauth"),
    payload: oauthCredentialPayloadSchema
  })
]);

export const credentialActivateParamsSchema = z.object({
  credentialId: z.coerce.number().int().positive()
});

export const credentialResponseSchema = z.object({
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  label: z.string().min(1),
  kind: credentialKindSchema,
  expiresAt: z.coerce.date().nullable(),
  active: z.boolean()
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

export const oauthStartResponseSchema = z.object({
  providerKey: z.string().min(1),
  authorizeUrl: z.string().url(),
  state: z.string().min(1)
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export type ProviderCreateRequest = z.infer<typeof providerCreateRequestSchema>;
export type ProviderResponse = z.infer<typeof providerResponseSchema>;
export type ModelCreateRequest = z.infer<typeof modelCreateRequestSchema>;
export type ModelResponse = z.infer<typeof modelResponseSchema>;
export type ApiKeyCredentialPayload = z.infer<typeof apiKeyCredentialPayloadSchema>;
export type OAuthCredentialPayload = z.infer<typeof oauthCredentialPayloadSchema>;
export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>;
export type CredentialActivateParams = z.infer<typeof credentialActivateParamsSchema>;
export type CredentialResponse = z.infer<typeof credentialResponseSchema>;
export type OAuthConfigCreateRequest = z.infer<typeof oauthConfigCreateRequestSchema>;
export type OAuthCompleteRequest = z.infer<typeof oauthCompleteRequestSchema>;
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
