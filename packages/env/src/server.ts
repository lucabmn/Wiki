import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { authSecretSchema, databaseUrlSchema, nodeEnvSchema } from "./shared";

export const env = createEnv({
  server: {
    DATABASE_URL: databaseUrlSchema,
    BETTER_AUTH_SECRET: authSecretSchema,
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: nodeEnvSchema,
    // Display name used by Better Auth (emails, passkey prompts). Lets
    // self-hosters white-label without patching source.
    APP_NAME: z.string().min(1).default("Nilovon Wiki"),
    // Port the real-time collaboration service (`apps/collab`) listens on.
    COLLAB_PORT: z.coerce.number().int().positive().default(1234),
    // Per-IP request ceilings (requests per minute). The general limit covers
    // /rpc and the REST surface; the auth limit protects /api/auth/* against
    // credential stuffing. Set high enough that normal usage never hits them.
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(60),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
