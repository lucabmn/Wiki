import { spawnStream } from "./proc";

/** Run a git command and return its trimmed output, or "" on any failure. */
async function gitOutput(args: string[]): Promise<string> {
  let out = "";
  try {
    // Output is merged stdout+stderr, so only trust it on a zero exit code.
    const code = await spawnStream(["git", ...args], (l) => (out = l.trim() || out));
    return code === 0 ? out : "";
  } catch {
    return ""; // git not installed
  }
}

/** Current short commit + branch, best-effort (empty on failure). */
export async function gitInfo(): Promise<{ rev: string; branch: string }> {
  const [rev, branch] = await Promise.all([
    gitOutput(["rev-parse", "--short", "HEAD"]),
    gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  return { rev, branch };
}

/**
 * `git pull --ff-only` — fast-forward only so an update never creates a merge.
 * Credential prompts are disabled: the TUI owns the terminal, so a prompt
 * would hang invisibly instead of failing with a readable error.
 */
export function gitPull(onLine?: (line: string) => void): Promise<number> {
  return spawnStream(["git", "pull", "--ff-only"], onLine, {
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
}
