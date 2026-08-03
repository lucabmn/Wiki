import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { authSecretSchema, databaseUrlSchema, nodeEnvSchema } from "./shared";

/**
 * Env surface for `apps/collab`. Narrower than the server env on purpose: the
 * collab service only verifies collab-token signatures (shared secret) and
 * persists Yjs snapshots — it must not require auth URLs or CORS config just
 * to boot.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: databaseUrlSchema,
    BETTER_AUTH_SECRET: authSecretSchema,
    NODE_ENV: nodeEnvSchema,
    COLLAB_PORT: z.coerce.number().int().positive().default(1234),
    /**
     * Optional. Only needed when collab runs on more than one instance —
     * Hocuspocus keeps each document in memory, so without Redis pub/sub two
     * clients served by different instances would never see each other's
     * edits. Mandatory on serverless platforms (see `src/vercel.ts`), unused
     * for the single-container docker-compose deploy.
     */
    REDIS_URL: z
      .string()
      .refine((value) => /^rediss?:\/\//.test(value), {
        message: "REDIS_URL must be a redis:// or rediss:// URL",
      })
      .optional(),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
