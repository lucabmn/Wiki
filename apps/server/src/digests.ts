import { runDueDigests } from "@nilovon-wiki/api/lib/notifications/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { log, parseError } from "evlog";
import { Hono } from "hono";

import { checkInternalToken } from "./internal-token";

/**
 * Drives the bundled-notification (digest) runner.
 *
 * Two triggers, one runner. `runDueDigests` claims its work in the database, so
 * both may be active at once without sending anything twice:
 *
 *   - an in-process ticker, for the long-lived container this normally ships as;
 *   - `POST /internal/digests/run`, for deployments where the process is not
 *     long-lived (serverless) or where an external scheduler owns the cadence.
 *
 * Nothing here decides *who* gets what — that lives in the API package next to
 * the access-control helpers it has to reuse.
 */

let running = false;

/**
 * Runs one batch, never concurrently with itself. A run that outlives its tick
 * (a large organization, a slow SMTP server) would otherwise pile ticks up
 * behind it; skipping is correct because the next tick finds the same work.
 */
async function tick(source: "timer" | "http"): Promise<ReturnType<typeof runDueDigests> | null> {
  if (running) {
    log.info({ source: "digests", msg: "run already in progress, skipping", trigger: source });
    return null;
  }
  running = true;
  try {
    const summary = await runDueDigests(db);
    // Quiet ticks are the common case; only log when something happened or the
    // install is misconfigured, so the log stays readable.
    if (summary.claimed > 0 || summary.adopted > 0 || summary.reason) {
      log.info({ source: "digests", msg: "digest run", trigger: source, ...summary });
    }
    return summary;
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the periodic runner. Idempotent — a second call is ignored. */
export function startDigestScheduler(): void {
  if (!env.DIGEST_SCHEDULER_ENABLED || timer) return;
  const intervalMs = env.DIGEST_TICK_SECONDS * 1000;
  timer = setInterval(() => {
    void tick("timer").catch((error) => {
      log.error({ source: "digests", ...parseError(error) });
    });
  }, intervalMs);
  // Never hold the process open on the scheduler alone; the HTTP server does
  // that, and a pending tick must not delay shutdown.
  timer.unref?.();
  log.info({
    source: "digests",
    msg: "scheduler started",
    intervalSeconds: env.DIGEST_TICK_SECONDS,
  });
}

export function stopDigestScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export const digestRoutes = new Hono();

/**
 * Manual/external trigger. Guarded by a shared secret rather than a session:
 * the caller is a scheduler, not a person, and the work it starts is expensive.
 */
digestRoutes.post("/digests/run", async (c) => {
  const auth = checkInternalToken(c.req.header("authorization"));
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  try {
    const summary = await tick("http");
    if (!summary) return c.json({ status: "busy" }, 202);
    return c.json({ status: "ok", ...summary });
  } catch (error) {
    log.error({ source: "digests", ...parseError(error) });
    return c.json({ error: "Digest run failed" }, 500);
  }
});
