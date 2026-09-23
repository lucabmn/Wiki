import { repoRoot } from "./paths";

export interface SpawnOptions {
  /** Extra env on top of the current process env. */
  env?: Record<string, string>;
  /** Working directory (defaults to the repo root). */
  cwd?: string;
}

/**
 * Spawn a command from the repo root, streaming merged stdout+stderr to
 * `onLine` line-by-line. Resolves with the exit code; never throws on non-zero,
 * but rejects when the executable cannot be started at all.
 */
export async function spawnStream(
  cmd: string[],
  onLine?: (line: string) => void,
  opts: SpawnOptions = {},
): Promise<number> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(cmd, {
      cwd: opts.cwd ?? repoRoot,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // Never hand the TUI's raw-mode stdin to a child process.
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    // Bun throws synchronously when the executable is missing (ENOENT) —
    // surface an actionable message instead of a raw errno string.
    throw new Error(
      `„${cmd[0]}" konnte nicht gestartet werden — ist es installiert und im PATH? ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        onLine?.(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode();
    if (buf.length) onLine?.(buf);
  };

  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  return await proc.exited;
}
