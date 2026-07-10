import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3002,
  },
  // lucide-react ships CommonJS; let Vite transform it so named icon imports
  // resolve during dev server-side rendering.
  ssr: {
    noExternal: ["lucide-react"],
  },
  resolve: {
    tsconfigPaths: true,
  },
  // base-ui (via @fumadocs/base-ui) imports named exports from the CommonJS
  // `use-sync-external-store` shim. Pre-bundle it so Vite exposes those named
  // exports to the browser; otherwise the client import resolves to undefined,
  // base-ui throws on hydration, and nothing interactive (sidebar collapse,
  // search, dropdowns) attaches.
  optimizeDeps: {
    include: ["use-sync-external-store/shim", "use-sync-external-store/shim/with-selector"],
  },
  plugins: [mdx(), tailwindcss(), tanstackStart(), viteReact(), nitro()],
});
