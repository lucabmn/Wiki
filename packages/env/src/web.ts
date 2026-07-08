import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Shape of Vite's `import.meta.env`. Declared locally so this package doesn't
 * need a dependency on vite (or its global `ImportMeta` augmentation) just to
 * read the injected env object.
 */
interface ViteImportMeta {
  readonly env: Record<string, string | boolean | undefined>;
}

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
  },
  runtimeEnv: (import.meta as unknown as ViteImportMeta).env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
