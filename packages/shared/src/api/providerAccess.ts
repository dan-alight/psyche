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
  scope: z.string().optional()
}).passthrough();

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
export type ApiKeyCredentialPayload = z.infer<typeof apiKeyCredentialPayloadSchema>;
export type OAuthCredentialPayload = z.infer<typeof oauthCredentialPayloadSchema>;
export type CredentialCreateRequest = z.infer<typeof credentialCreateRequestSchema>;
export type CredentialActivateParams = z.infer<typeof credentialActivateParamsSchema>;
export type OAuthConfigCreateRequest = z.infer<typeof oauthConfigCreateRequestSchema>;
export type OAuthCompleteRequest = z.infer<typeof oauthCompleteRequestSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
