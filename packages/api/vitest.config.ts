import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites boot a fresh pglite instance and apply every migration
    // in `beforeAll` — the 10s default is too tight on slower CI runners.
    hookTimeout: 30_000,
    testTimeout: 20_000,
    // Some routers (e.g. page.ts → collab tokens) import the validated server
    // env at module load. Tests run on pglite and never touch these services,
    // so provide deterministic values instead of depending on a local .env.
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/vitest-unused",
      BETTER_AUTH_SECRET: "vitest-integration-signing-key-0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:3001",
    },
  },
});
