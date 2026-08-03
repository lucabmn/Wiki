import { defineConfig } from "tsdown";

/**
 * Only the serverless entry is bundled. The long-lived entry (`src/index.ts`)
 * is executed straight from TypeScript by `tsx` inside the Docker image and
 * needs no build step; Vercel's Node builder, on the other hand, cannot resolve
 * the workspace packages' raw-TypeScript exports through pnpm symlinks, so
 * `noExternal` inlines them and leaves only real npm dependencies as imports.
 */
export default defineConfig({
  entry: "./src/vercel.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  dts: false,
  noExternal: [/@nilovon-wiki\/.*/],
});
