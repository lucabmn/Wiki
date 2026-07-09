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
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
