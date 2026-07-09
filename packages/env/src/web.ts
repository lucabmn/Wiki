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
    // WebSocket origin of the real-time collaboration service (`apps/collab`),
    // e.g. `ws://localhost:1234` in dev or `wss://collab.example.com` behind TLS.
    VITE_COLLAB_URL: z
      .url()
      .refine((value) => value.startsWith("ws://") || value.startsWith("wss://"), {
        message: "VITE_COLLAB_URL must be a ws:// or wss:// URL",
      }),
  },
  runtimeEnv: (import.meta as unknown as ViteImportMeta).env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
