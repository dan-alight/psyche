import { migrateDatabase } from "@/db/client";
import { env } from "@/env";
import { initializeConversationManager } from "@/conversations/ConversationManager";
import { buildServer } from "@/server";

migrateDatabase();

const conversationManager = await initializeConversationManager();
const app = await buildServer({ conversationManager });

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
