import { spawnStream } from "./proc";

/** Current short commit + branch, best-effort (empty on failure). */
export async function gitInfo(): Promise<{ rev: string; branch: string }> {
  let rev = "";
  let branch = "";
  await spawnStream(["git", "rev-parse", "--short", "HEAD"], (l) => (rev = l.trim() || rev));
  await spawnStream(
    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    (l) => (branch = l.trim() || branch),
  );
  return { rev, branch };
}

/** `git pull --ff-only` — fast-forward only so an update never creates a merge. */
export function gitPull(onLine?: (line: string) => void): Promise<number> {
  return spawnStream(["git", "pull", "--ff-only"], onLine);
}
