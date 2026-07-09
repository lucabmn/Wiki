import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

/** Walk up from `start` until a directory containing docker-compose.yml is found. */
function walkUp(start: string): string | null {
  let dir = start;
  // Stop at the filesystem root: dirname("/") === "/".
  for (;;) {
    if (existsSync(join(dir, "docker-compose.yml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Locate the monorepo root (the directory that holds `docker-compose.yml`).
 *
 * Tried in order:
 * 1. The current working directory and its ancestors — this is the path the
 *    compiled installer binary relies on (its `import.meta.dir` points into
 *    Bun's virtual bundle filesystem, not the real disk).
 * 2. This file's directory and its ancestors — covers `pnpm dev:tui`, where
 *    the source lives inside the checkout regardless of cwd.
 */
export function findRepoRoot(): string {
  const fromCwd = walkUp(process.cwd());
  if (fromCwd) return fromCwd;

  const fromSource = walkUp(import.meta.dir);
  if (fromSource) return fromSource;

  throw new Error(
    "Repo-Root nicht gefunden (keine docker-compose.yml oberhalb von " +
      `${process.cwd()}). Führe den Installer aus dem geklonten Wiki-Verzeichnis aus:\n` +
      "  git clone https://github.com/Nilovon/Wiki.git && cd Wiki && ./nilovon-wiki-installer",
  );
}

export const repoRoot = findRepoRoot();

/** Absolute path to an env file the installer writes, relative to the repo root. */
export function envPath(rel: string): string {
  return join(repoRoot, rel);
}
