import { migrateDatabase } from "@/db/client";
import { env } from "@/env";
import { buildServer } from "@/server";

migrateDatabase();

const app = await buildServer();

await app.listen({
  host: env.API_HOST,
  port: env.API_PORT
});
