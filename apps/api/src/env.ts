import { z } from "zod";

const envSchema = z.object({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(16).default("local-development-credential-key"),
  DATABASE_URL: z.string().default("./psyche.db"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173")
});

export const env = envSchema.parse(process.env);
