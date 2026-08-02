import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The mail module imports the validated server env at load time. These
    // values are never dialled — the SMTP host is overridden per test.
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/vitest-unused",
      BETTER_AUTH_SECRET: "vitest-integration-signing-key-0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:3000",
      CORS_ORIGIN: "http://localhost:3001",
      SMTP_FROM: "Nilovon Wiki <wiki@example.test>",
    },
  },
});
