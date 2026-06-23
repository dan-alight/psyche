import { migrateDatabase } from "@/db/client";
import { env } from "@/env";
import { AgentHarness } from "@/agents/AgentHarness";
import { initializeConversationManager } from "@/conversations/ConversationManager";
import { refreshOAuthToken } from "@/providerOAuth";
import { createDrizzleProviderAccessStore } from "@/providerStore";
import { buildServer } from "@/server";

migrateDatabase();

const conversationManager = await initializeConversationManager();
const providerStore = createDrizzleProviderAccessStore();
const agentHarness = new AgentHarness({
  store: providerStore,
  credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
  conversationManager,
  refreshOAuthToken,
});
const app = await buildServer({
  agentHarness,
  conversationManager,
  providerStore,
});

const abortedModelCalls = await conversationManager.abortRunningModelCalls();

if (abortedModelCalls > 0) {
  app.log.warn(
    { abortedModelCalls },
    "Aborted running model calls on startup",
  );
}

await app.listen({
  host: env.API_HOST,
  port: env.API_PORT
});
