import { migrateDatabase } from "@/db/client";
import { env } from "@/env";
import { createDrizzleConversationStore } from "@/modelClients/conversationStore";
import { buildServer } from "@/server";

migrateDatabase();

const app = await buildServer();
const conversationStore = createDrizzleConversationStore();

const abortedModelCalls = await conversationStore.abortRunningModelCalls();

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
