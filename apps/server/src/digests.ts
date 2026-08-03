import { runDueDigests } from "@nilovon-wiki/api/lib/notifications/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { log, parseError } from "evlog";
import { Hono } from "hono";

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
 * Compared in full so a wrong token cannot be probed byte by byte.
 */
digestRoutes.post("/digests/run", async (c) => {
  const expected = env.DIGEST_RUN_TOKEN;
  if (!expected) {
    return c.json({ error: "DIGEST_RUN_TOKEN is not configured" }, 501);
  }
  const header = c.req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(presented, expected)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const summary = await tick("http");
    if (!summary) return c.json({ status: "busy" }, 202);
    return c.json({ status: "ok", ...summary });
  } catch (error) {
    log.error({ source: "digests", ...parseError(error) });
    return c.json({ error: "Digest run failed" }, 500);
  }
});

/**
 * Constant-time comparison for equal-length strings, so a wrong token cannot be
 * probed byte by byte. The length check short-circuits and therefore leaks the
 * token's length — which is not secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
