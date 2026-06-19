import { and, eq } from "drizzle-orm";

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
  getProviderByKey(providerKey: string): Promise<ProviderRecord | undefined>;
  createModel(input: CreateModelInput): Promise<ModelRecord>;
  listModels(providerId?: number): Promise<ModelRecord[]>;
  createCredential(input: CreateCredentialInput): Promise<CredentialRecord>;
  listCredentials(providerId?: number): Promise<PublicCredentialRecord[]>;
  activateCredential(credentialId: number): Promise<PublicCredentialRecord | undefined>;
  getActiveCredentialByProviderKey(providerKey: string): Promise<CredentialRecord | undefined>;
  updateCredentialSecret(input: {
    credentialId: number;
    encryptedPayload: string;
    expiresAt?: Date | null;
  }): Promise<CredentialRecord | undefined>;
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
    async getProviderByKey(providerKey) {
      const rows = await db.select().from(provider).where(eq(provider.key, providerKey)).limit(1);
      return rows[0];
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
      if (!input.active) {
        const rows = await db.insert(credential).values(input).returning();
        return rows[0]!;
      }

      return db.transaction((tx) => {
        tx
          .update(credential)
          .set({ active: false })
          .where(eq(credential.providerId, input.providerId))
          .run();

        const rows = tx.insert(credential).values(input).returning().all();
        return rows[0]!;
      });
    },
    async listCredentials(providerId) {
      const rows = providerId
        ? await db.select().from(credential).where(eq(credential.providerId, providerId))
        : await db.select().from(credential);

      return rows.map(hideCredentialSecret);
    },
    async activateCredential(credentialId) {
      return db.transaction((tx) => {
        const target = tx.select().from(credential).where(eq(credential.id, credentialId)).get();

        if (!target) {
          return undefined;
        }

        tx
          .update(credential)
          .set({ active: false })
          .where(eq(credential.providerId, target.providerId))
          .run();

        const activated = tx
          .update(credential)
          .set({ active: true })
          .where(eq(credential.id, credentialId))
          .returning()
          .get();

        return activated ? hideCredentialSecret(activated) : undefined;
      });
    },
    async getActiveCredentialByProviderKey(providerKey) {
      const rows = await db
        .select({
          id: credential.id,
          providerId: credential.providerId,
          label: credential.label,
          kind: credential.kind,
          encryptedPayload: credential.encryptedPayload,
          expiresAt: credential.expiresAt,
          active: credential.active
        })
        .from(credential)
        .innerJoin(provider, eq(provider.id, credential.providerId))
        .where(and(eq(provider.key, providerKey), eq(credential.active, true)))
        .limit(1);

      return rows[0];
    },
    async updateCredentialSecret(input) {
      const rows = await db
        .update(credential)
        .set({
          encryptedPayload: input.encryptedPayload,
          expiresAt: input.expiresAt ?? null
        })
        .where(eq(credential.id, input.credentialId))
        .returning();

      return rows[0];
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
