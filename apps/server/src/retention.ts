import { runRetention } from "@nilovon-wiki/api/lib/retention/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { log, parseError } from "evlog";
import { Hono } from "hono";

import { checkInternalAuth } from "./internal-auth";

/**
 * Drives the data-retention runner: the audit window and the trash expiry.
 *
 * Two triggers, one runner — the same arrangement the digest runner uses, for
 * the same reason. `runRetention` claims each organization in the database, so
 * both may be active at once (and several replicas may run) without deleting
 * anything twice:
 *
 *   - an in-process ticker, for the long-lived container this normally ships as;
 *   - `POST /internal/retention/run`, for deployments where the process is not
 *     long-lived (serverless) or an external scheduler owns the cadence.
 *
 * Nothing here decides *what* may be deleted. That lives in the API package,
 * next to the deletion-block rules the request path has to reuse — two copies of
 * that decision is precisely how a purge job ends up removing something a user
 * was told was protected.
 */

let running = false;

/**
 * Runs one batch, never concurrently with itself. The database claim already
 * makes overlap safe; this only avoids pointless work when a run outlives its
 * tick. Skipping is correct because the next tick finds the same work.
 */
async function tick(source: "timer" | "http"): Promise<ReturnType<typeof runRetention> | null> {
  if (running) {
    log.info({ source: "retention", msg: "run already in progress, skipping", trigger: source });
    return null;
  }
  running = true;
  try {
    const summary = await runRetention(db, { batchLimit: env.RETENTION_BATCH_LIMIT });
    // Deletions are always logged, with a count per category — an operator has
    // to be able to answer "what did the job remove last night?" from the logs
    // alone. Quiet runs stay silent so the log remains readable.
    const removed =
      summary.auditDeleted + summary.pagesPurged + summary.spacesPurged + summary.attachmentsPurged;
    if (removed > 0 || summary.heldSkipped > 0 || summary.pending > 0) {
      log.info({ source: "retention", msg: "retention run", trigger: source, ...summary });
    }
    return summary;
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the periodic runner. Idempotent — a second call is ignored. */
export function startRetentionScheduler(): void {
  if (!env.RETENTION_SCHEDULER_ENABLED || timer) return;
  timer = setInterval(() => {
    void tick("timer").catch((error) => {
      log.error({ source: "retention", ...parseError(error) });
    });
  }, env.RETENTION_TICK_SECONDS * 1000);
  // Never hold the process open on the scheduler alone; the HTTP server does
  // that, and a pending tick must not delay shutdown.
  timer.unref?.();
  log.info({
    source: "retention",
    msg: "scheduler started",
    intervalSeconds: env.RETENTION_TICK_SECONDS,
  });
}

export function stopRetentionScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export const retentionRoutes = new Hono();

/**
 * Manual/external trigger. Guarded by the shared `/internal` token rather than a
 * session: the caller is a scheduler, and the work it starts deletes data.
 */
retentionRoutes.post("/retention/run", async (c) => {
  const failure = checkInternalAuth(c);
  if (failure) return c.json(failure.body, failure.status);

  try {
    const summary = await tick("http");
    if (!summary) return c.json({ status: "busy" }, 202);
    return c.json({ status: "ok", ...summary });
  } catch (error) {
    log.error({ source: "retention", ...parseError(error) });
    return c.json({ error: "Retention run failed" }, 500);
  }
});
