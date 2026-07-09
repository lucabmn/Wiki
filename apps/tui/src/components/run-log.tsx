import { useState } from "react";
import { theme } from "../theme";
import { allHealthy, composePs, serviceReady, type ServiceStatus } from "../lib/docker";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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
export async function pollUntilHealthy(
  onStatuses: (s: ServiceStatus[]) => void,
  signal: AbortSignal,
  { retries = 40, interval = 3000 } = {},
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (signal.aborted) return false;
    const s = await composePs();
    if (signal.aborted) return false;
    onStatuses(s);
    if (allHealthy(s)) return true;
    await sleep(interval);
  }
  return false;
}

/** Poll until one named service is ready (used to gate the schema push). */
export async function pollUntilServiceReady(
  name: string,
  onStatuses: (s: ServiceStatus[]) => void,
  signal: AbortSignal,
  { retries = 30, interval = 2000 } = {},
): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (signal.aborted) return false;
    const s = await composePs();
    if (signal.aborted) return false;
    onStatuses(s);
    if (serviceReady(s, name)) return true;
    await sleep(interval);
  }
  return false;
}

export function StatusRow({ statuses }: { statuses: ServiceStatus[] }) {
  if (statuses.length === 0) return null;
  return (
    <box flexDirection="row" gap={2}>
      {statuses.map((s) => (
        <box key={s.name} flexDirection="row" gap={1}>
          <text fg={healthColor(s)}>{healthGlyph(s)}</text>
          <text fg={theme.fg}>{s.name}</text>
        </box>
      ))}
    </box>
  );
}

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
      {log.slice(-16).map((line, i) => (
        <text key={i} fg={logColor(line)}>
          {line}
        </text>
      ))}
    </box>
  );
}

function healthColor(s: ServiceStatus): string {
  if (s.state !== "running" || s.health === "unhealthy") return theme.err;
  if (s.health === "starting") return theme.warn;
  return theme.ok;
}
function healthGlyph(s: ServiceStatus): string {
  if (s.state !== "running" || s.health === "unhealthy") return "✘";
  if (s.health === "starting") return "●";
  return "✔";
}
function logColor(line: string): string {
  if (line.startsWith("✘") || /error|fehlgeschlagen/i.test(line)) return theme.err;
  if (line.startsWith("✔")) return theme.ok;
  if (line.startsWith("→") || line.startsWith("●")) return theme.accent;
  return theme.dim;
}
