import { useState } from "react";
import { theme } from "../theme";
import { allHealthy, composePs, composeUp, serviceOk, type ServiceStatus } from "../lib/docker";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LOG_KEEP = 500;

/** Append-only log buffer with a bounded tail, plus a live service-status row. */
export function useRunLog() {
  const [log, setLog] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
  const append = (line: string) => setLog((l) => [...l, line].slice(-LOG_KEEP));
  const reset = () => {
    setLog([]);
    setStatuses([]);
  };
  return { log, statuses, setStatuses, append, reset };
}

/**
 * Poll `docker compose ps` until every service is healthy, or the retry budget
 * runs out. Returns true on success. Honours the AbortSignal for unmount.
 */
async function pollUntilHealthy(
  production: boolean,
  onStatuses: (s: ServiceStatus[]) => void,
  signal: AbortSignal,
  { retries = 40, interval = 3000 } = {},
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (signal.aborted) return false;
    const s = await composePs(production);
    if (signal.aborted) return false;
    onStatuses(s);
    if (allHealthy(s)) return true;
    await sleep(interval);
  }
  return false;
}

/**
 * The shared tail of install/configure/update: `compose up -d --build`, then
 * wait for health checks. Resolves "done" only when every service is healthy —
 * a build failure or a health-check timeout is an "error" (retryable), and
 * "aborted" means the screen unmounted and the caller must not touch state.
 */
export async function upAndWaitHealthy(opts: {
  production: boolean;
  append: (line: string) => void;
  onStatuses: (s: ServiceStatus[]) => void;
  signal: AbortSignal;
  successMessage: string;
}): Promise<"done" | "error" | "aborted"> {
  const { production, append, onStatuses, signal, successMessage } = opts;
  const code = await composeUp(production, (l) => !signal.aborted && append(l));
  if (signal.aborted) return "aborted";
  if (code !== 0) {
    append(`✘ docker compose beendet mit Code ${code}.`);
    return "error";
  }

  append("→ Warte auf Health-Checks …");
  const healthy = await pollUntilHealthy(production, onStatuses, signal);
  if (signal.aborted) return "aborted";
  if (!healthy) {
    append("✘ Timeout — nicht alle Dienste wurden healthy. Prüfe `docker compose logs`.");
    return "error";
  }
  append(successMessage);
  return "done";
}

export function StatusRow({ statuses }: { statuses: ServiceStatus[] }) {
  if (statuses.length === 0) return null;
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
      {statuses.map((s) => (
        <box key={s.name} flexDirection="row" gap={1}>
          <text fg={healthColor(s)}>{healthGlyph(s)}</text>
          <text fg={theme.fg}>{s.name}</text>
        </box>
      ))}
    </box>
  );
}

/** Scrollable log that sticks to the newest line and adapts to terminal height. */
export function LogBox({ log, title = " Ausgabe " }: { log: string[]; title?: string }) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={theme.border}
      title={title}
      titleColor={theme.accent}
      paddingX={1}
    >
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
        {log.map((line, i) => (
          <text key={i} fg={logColor(line)}>
            {line}
          </text>
        ))}
      </scrollbox>
    </box>
  );
}

// A completed one-shot (e.g. `migrate`, exited 0) is a success, not a failure.
function healthColor(s: ServiceStatus): string {
  if (serviceOk(s)) return theme.ok;
  if (s.state === "running" && s.health === "starting") return theme.warn;
  return theme.err;
}
function healthGlyph(s: ServiceStatus): string {
  if (serviceOk(s)) return "✔";
  if (s.state === "running" && s.health === "starting") return "●";
  return "✘";
}
function logColor(line: string): string {
  if (line.startsWith("✘") || /error|fehlgeschlagen/i.test(line)) return theme.err;
  if (line.startsWith("✔")) return theme.ok;
  if (line.startsWith("→") || line.startsWith("●")) return theme.accent;
  return theme.dim;
}
