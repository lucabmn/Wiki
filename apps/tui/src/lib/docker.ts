import { spawnStream } from "./proc";

/**
 * Shell out to `docker compose` from the repo root, streaming merged
 * stdout+stderr to `onLine`. Resolves with the process exit code (0 = success).
 * Never throws on a non-zero exit — the caller inspects the code.
 */
export function runCompose(args: string[], onLine?: (line: string) => void): Promise<number> {
  return spawnStream(["docker", "compose", ...args], onLine);
}

/** Bring the whole stack up in the background, rebuilding images. */
export function composeUp(onLine?: (line: string) => void): Promise<number> {
  return runCompose(["up", "-d", "--build"], onLine);
}

/** Bring specific services up in the background (no rebuild). */
export function composeUpServices(
  services: string[],
  onLine?: (line: string) => void,
): Promise<number> {
  return runCompose(["up", "-d", ...services], onLine);
}

/** Tear the stack down (used by a failed/cancelled install). */
export function composeDown(onLine?: (line: string) => void): Promise<number> {
  return runCompose(["down"], onLine);
}

export type ServiceHealth = "healthy" | "unhealthy" | "starting" | "none" | "unknown";

export interface ServiceStatus {
  name: string;
  /** compose service state, e.g. "running", "exited". */
  state: string;
  health: ServiceHealth;
}

function normalizeHealth(raw: string | undefined): ServiceHealth {
  switch ((raw ?? "").toLowerCase()) {
    case "healthy":
      return "healthy";
    case "unhealthy":
      return "unhealthy";
    case "starting":
      return "starting";
    case "":
    case "none":
      return "none";
    default:
      return "unknown";
  }
}

/**
 * Parse `docker compose ps --format json`. Docker emits either NDJSON (one
 * object per line, newer CLIs) or a single JSON array — handle both.
 */
export async function composePs(): Promise<ServiceStatus[]> {
  const lines: string[] = [];
  await runCompose(["ps", "--format", "json"], (l) => {
    const t = l.trim();
    if (t) lines.push(t);
  });

  const raw = lines.join("\n").trim();
  if (!raw) return [];

  let records: any[];
  try {
    if (raw.startsWith("[")) {
      records = JSON.parse(raw);
    } else {
      records = lines.map((l) => JSON.parse(l));
    }
  } catch {
    return [];
  }

  return records.map((r) => ({
    name: r.Service ?? r.Name ?? "unknown",
    state: (r.State ?? "").toString(),
    health: normalizeHealth(r.Health),
  }));
}

/** True when every service is running and no service is unhealthy/starting. */
export function allHealthy(statuses: ServiceStatus[]): boolean {
  if (statuses.length === 0) return false;
  return statuses.every(
    (s) => s.state === "running" && (s.health === "healthy" || s.health === "none"),
  );
}

/** A single service is up and its healthcheck (if any) is green. */
export function serviceReady(statuses: ServiceStatus[], name: string): boolean {
  const s = statuses.find((x) => x.name === name);
  return !!s && s.state === "running" && (s.health === "healthy" || s.health === "none");
}
