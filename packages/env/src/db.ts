import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { databaseUrlSchema } from "./shared";

/**
 * Minimal env surface for `packages/db`. The db package used to import the
 * full server env, which forced every consumer (e.g. the collab service or a
 * one-shot migration container) to provide auth/CORS variables it never uses.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: databaseUrlSchema,
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
