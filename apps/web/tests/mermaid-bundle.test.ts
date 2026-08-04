import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs with the app package as its working directory.
const SOURCE_ROOT = resolve(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * Mermaid is ~500 kB. It must stay behind a dynamic import so it is fetched
 * only by pages that actually show a diagram — a static import anywhere in
 * `src/` would pull it into the entry chunk of the whole app. This is the
 * documented check the ticket asks for: it fails the moment someone writes
 * `import mermaid from "mermaid"`.
 */
describe("Mermaid bundling", () => {
  const files = sourceFiles(SOURCE_ROOT);

  it("is never imported statically", () => {
    const offenders = files.filter((file) =>
      /^\s*import\s[^\n]*from\s+["']mermaid["']|^\s*import\s+["']mermaid["']/m.test(
        readFileSync(file, "utf8"),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("is loaded through exactly one dynamic import", () => {
    const loaders = files.filter((file) =>
      /import\(\s*["']mermaid["']\s*\)/.test(readFileSync(file, "utf8")),
    );

    expect(loaders.map((file) => file.slice(SOURCE_ROOT.length))).toEqual([
      "/components/editor/mermaid/render.ts",
    ]);
  });
});
