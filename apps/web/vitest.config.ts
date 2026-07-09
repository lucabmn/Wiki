import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone from vite.config.ts on purpose: the app config runs the TanStack
// Start plugin (route-tree codegen, Nitro), none of which the unit tests need.
export default defineConfig({
  // vitest bundles vite 7's plugin types while the app is on vite 8; the shapes
  // are runtime-compatible, only the static types clash here.
  // @ts-expect-error cross-vite-version Plugin type mismatch
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Deterministic client env so tests never depend on a developer's .env.
    env: {
      VITE_SERVER_URL: "http://localhost:3000",
      VITE_COLLAB_URL: "ws://localhost:1234",
    },
  },
});
