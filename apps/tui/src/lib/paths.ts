import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Walk up from this file until the monorepo root is found (the directory that
 * holds `docker-compose.yml`). The TUI ships inside the repo it installs, so the
 * root is always an ancestor — no cwd guessing.
 */
export function findRepoRoot(start = import.meta.dir): string {
  let dir = start;
  // Stop at the filesystem root: dirname("/") === "/".
  for (;;) {
    if (existsSync(join(dir, "docker-compose.yml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not locate the repo root (no docker-compose.yml found above " +
          `${start}). Run the TUI from inside the nilovon-wiki checkout.`,
      );
    }
    dir = parent;
  }
}

export const repoRoot = findRepoRoot();

/** Absolute path to an env file the installer writes, relative to the repo root. */
export function envPath(rel: string): string {
  return join(repoRoot, rel);
}
