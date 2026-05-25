import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { credential, model, oauthConfig, provider } from "@/db/schema";

export type ProviderRecord = typeof provider.$inferSelect;
export type CreateProviderInput = typeof provider.$inferInsert;

export type ModelRecord = typeof model.$inferSelect;
export type CreateModelInput = typeof model.$inferInsert;

export type CredentialRecord = typeof credential.$inferSelect;
export type CreateCredentialInput = typeof credential.$inferInsert;
export type PublicCredentialRecord = Omit<CredentialRecord, "encryptedPayload">;

export type OAuthConfigRecord = typeof oauthConfig.$inferSelect;
export type CreateOAuthConfigInput = typeof oauthConfig.$inferInsert;

export type ProviderAccessStore = {
  createProvider(input: CreateProviderInput): Promise<ProviderRecord>;
  listProviders(): Promise<ProviderRecord[]>;
  createModel(input: CreateModelInput): Promise<ModelRecord>;
  listModels(providerId?: number): Promise<ModelRecord[]>;
  createCredential(input: CreateCredentialInput): Promise<CredentialRecord>;
  listCredentials(providerId?: number): Promise<PublicCredentialRecord[]>;
  createOAuthConfig(input: CreateOAuthConfigInput): Promise<OAuthConfigRecord>;
  getOAuthConfigByProviderKey(providerKey: string): Promise<OAuthConfigRecord | undefined>;
};

function hideCredentialSecret(record: CredentialRecord): PublicCredentialRecord {
  const { encryptedPayload: _encryptedPayload, ...publicRecord } = record;
  return publicRecord;
}

export function createDrizzleProviderAccessStore(): ProviderAccessStore {
  return {
    async createProvider(input) {
      const rows = await db.insert(provider).values(input).returning();
      return rows[0]!;
    },
    async listProviders() {
      return db.select().from(provider);
    },
    async createModel(input) {
      const rows = await db.insert(model).values(input).returning();
      return rows[0]!;
    },
    async listModels(providerId) {
      if (providerId) {
        return db.select().from(model).where(eq(model.providerId, providerId));
      }

      return db.select().from(model);
    },
    async createCredential(input) {
      const rows = await db.insert(credential).values(input).returning();
      return rows[0]!;
    },
    async listCredentials(providerId) {
      const rows = providerId
        ? await db.select().from(credential).where(eq(credential.providerId, providerId))
        : await db.select().from(credential);

      return rows.map(hideCredentialSecret);
    },
    async createOAuthConfig(input) {
      const rows = await db.insert(oauthConfig).values(input).returning();
      return rows[0]!;
    },
    async getOAuthConfigByProviderKey(providerKey) {
      const rows = await db
        .select({
          id: oauthConfig.id,
          providerId: oauthConfig.providerId,
          authorizeUrl: oauthConfig.authorizeUrl,
          tokenUrl: oauthConfig.tokenUrl,
          clientId: oauthConfig.clientId,
          scopes: oauthConfig.scopes,
          extraAuthorizeParams: oauthConfig.extraAuthorizeParams,
          redirectUri: oauthConfig.redirectUri
        })
        .from(oauthConfig)
        .innerJoin(provider, eq(provider.id, oauthConfig.providerId))
        .where(eq(provider.key, providerKey))
        .limit(1);
      return rows[0];
    }
  };
}
