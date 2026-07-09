import { repoRoot } from "./paths";

export interface SpawnOptions {
  /** Extra env on top of the current process env. */
  env?: Record<string, string>;
  /** Working directory (defaults to the repo root). */
  cwd?: string;
}

/**
 * Spawn a command from the repo root, streaming merged stdout+stderr to
 * `onLine` line-by-line. Resolves with the exit code; never throws on non-zero.
 */
export async function spawnStream(
  cmd: string[],
  onLine?: (line: string) => void,
  opts: SpawnOptions = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        onLine?.(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf.length) onLine?.(buf);
  };

  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  return await proc.exited;
}
