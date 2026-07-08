import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration suites boot a fresh pglite instance and apply every migration
    // in `beforeAll` — the 10s default is too tight on slower CI runners.
    hookTimeout: 30_000,
    testTimeout: 20_000,
  },
});
