import { isMailConfigured } from "@nilovon-wiki/auth/mail";
import { getStorage, isStorageConfigured } from "@nilovon-wiki/api/lib/storage";
import { pingDb } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { log, parseError } from "evlog";
import { Hono } from "hono";

/**
 * Three questions, three routes — because an orchestrator and a monitoring
 * system are asking different things and answering both from one endpoint gets
 * one of them wrong.
 *
 *   /health/live   Is this process alive? Nothing external is touched, so a
 *                  failing database can never make Docker kill a server that
 *                  is working fine.
 *   /health        Can this process serve? Database only. This is what the
 *                  compose healthcheck and any orchestrator watch, and it is
 *                  deliberately narrow: object storage and the collaboration
 *                  service failing does not make restarting the API the right
 *                  answer, and a cascade of restarts is worse than degraded
 *                  attachments.
 *   /health/ready  How is everything the deployment depends on? Every
 *                  dependency is probed and reported per component, with 503
 *                  when any *configured* one is unreachable. This is the one to
 *                  point alerting at — it is what closes the gap where the API
 *                  reported "ok" while nobody could upload a file or edit
 *                  together.
 *
 * None of them requires authentication. They expose no tenant data and no
 * version — only whether a dependency answers — and a probe that needs a
 * credential is a probe that silently stops working when the credential rotates.
 */

/** Bounded so a hung dependency cannot make the health check itself hang. */
const PROBE_TIMEOUT_MS = 2000;

export type ComponentStatus = "ok" | "unreachable" | "disabled";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Record<string, { status: ComponentStatus; detail?: string }>;
}

function collabUrl(): string {
  return env.COLLAB_INTERNAL_URL ?? `http://127.0.0.1:${env.COLLAB_PORT}`;
}

/** Wraps a probe so a throw becomes a report rather than a 500. */
async function probe(
  name: string,
  run: () => Promise<void>,
): Promise<[string, { status: ComponentStatus; detail?: string }]> {
  try {
    await run();
    return [name, { status: "ok" }];
  } catch (error) {
    log.warn({ source: "health", component: name, ...parseError(error) });
    // The message can carry an endpoint or a bucket name, which is fine for an
    // operator reading a health page — but not credentials, so only the error's
    // own text is passed through, never the configuration.
    const detail = error instanceof Error ? error.message : "probe failed";
    return [name, { status: "unreachable", detail }];
  }
}

async function probeDatabase() {
  return probe("database", async () => {
    await pingDb();
  });
}

/**
 * Object storage. A `list` rather than a `HEAD` on some key: listing fails when
 * the bucket is missing or the credentials are wrong, which are exactly the two
 * misconfigurations that look healthy until the first upload.
 */
async function probeStorage(): Promise<[string, { status: ComponentStatus; detail?: string }]> {
  if (!isStorageConfigured()) return ["storage", { status: "disabled" }];
  return probe("storage", async () => {
    const storage = getStorage();
    if (!storage) throw new Error("storage client unavailable");
    await storage.list({ limit: 1, timeout: PROBE_TIMEOUT_MS });
  });
}

/**
 * The collaboration service speaks WebSocket, so a plain GET is answered with
 * an error status rather than a document — which is the signal wanted here.
 * *Any* HTTP reply proves the process is listening; only a transport failure or
 * a timeout means unreachable, and that is what breaks collaborative editing.
 */
async function probeCollab() {
  return probe("collab", async () => {
    await fetch(collabUrl(), {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  });
}

/** Probes every dependency concurrently and folds the results into one report. */
export async function checkDependencies(): Promise<HealthReport> {
  const results = await Promise.all([probeDatabase(), probeStorage(), probeCollab()]);

  const checks: HealthReport["checks"] = Object.fromEntries(results);
  // Mail has no cheap probe that isn't an actual SMTP dialogue, so it is
  // reported as configured-or-not rather than pretended to be tested.
  checks.mail = { status: isMailConfigured() ? "ok" : "disabled" };

  const degraded = Object.values(checks).some((check) => check.status === "unreachable");
  return { status: degraded ? "degraded" : "ok", checks };
}

export const healthRoutes = new Hono();

// Liveness. Deliberately touches nothing: if this process can answer, it is
// alive, and restarting it would not fix a dependency anyway.
healthRoutes.get("/health/live", (c) => c.json({ status: "ok" }));

// Readiness for the orchestrator. Database only — see the note at the top.
healthRoutes.get("/health", async (c) => {
  const [, database] = await probeDatabase();
  if (database.status !== "ok") {
    return c.json({ status: "unhealthy", checks: { database } }, 503);
  }
  return c.json({ status: "ok", checks: { database } });
});

// The full dependency report, for monitoring and for the operator's own eyes.
healthRoutes.get("/health/ready", async (c) => {
  const report = await checkDependencies();
  return c.json(report, report.status === "ok" ? 200 : 503);
});
