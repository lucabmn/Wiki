import { runDueWebhooks } from "@nilovon-wiki/api/lib/webhooks/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { log, parseError } from "evlog";
import { Hono } from "hono";

import { checkInternalToken } from "./internal-token";

/**
 * Drives the outbound-webhook runner.
 *
 * Same shape as the digest runner next door, for the same reasons:
 *
 *   - an in-process ticker, for the long-lived container this normally ships as;
 *   - `POST /internal/webhooks/run`, for deployments where the process is not
 *     long-lived (serverless) or where an external scheduler owns the cadence.
 *
 * `runDueWebhooks` claims its work in the database, so both may be active at
 * once without any event being delivered twice.
 */

let running = false;

/**
 * Runs one batch, never concurrently with itself. A run that outlives its tick
 * (a slow receiver, a long queue) would otherwise pile ticks up behind it;
 * skipping is correct because the next tick finds the same work.
 */
async function tick(
  source: "timer" | "http",
): Promise<Awaited<ReturnType<typeof runDueWebhooks>> | null> {
  if (running) {
    log.info({ source: "webhooks", msg: "run already in progress, skipping", trigger: source });
    return null;
  }
  running = true;
  try {
    const summary = await runDueWebhooks(db);
    // Idle ticks are the common case and would drown the log; report only runs
    // that actually moved something.
    if (summary.claimed > 0) {
      log.info({ source: "webhooks", msg: "webhook run", trigger: source, ...summary });
    }
    return summary;
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the periodic runner. Idempotent — a second call is ignored. */
export function startWebhookScheduler(): void {
  if (!env.WEBHOOK_SCHEDULER_ENABLED || timer) return;
  timer = setInterval(() => {
    void tick("timer").catch((error) => {
      log.error({ source: "webhooks", ...parseError(error) });
    });
  }, env.WEBHOOK_TICK_SECONDS * 1000);
  // Never hold the process open on the scheduler alone; the HTTP server does
  // that, and a pending tick must not delay shutdown.
  timer.unref?.();
  log.info({
    source: "webhooks",
    msg: "scheduler started",
    intervalSeconds: env.WEBHOOK_TICK_SECONDS,
  });
}

export function stopWebhookScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export const webhookRoutes = new Hono();

/** Manual/external trigger. Guarded by the shared runner token, not a session. */
webhookRoutes.post("/webhooks/run", async (c) => {
  const auth = checkInternalToken(c.req.header("authorization"));
  if (!auth.ok) return c.json({ error: auth.error }, auth.status);

  try {
    const summary = await tick("http");
    if (!summary) return c.json({ status: "busy" }, 202);
    return c.json({ status: "ok", ...summary });
  } catch (error) {
    log.error({ source: "webhooks", ...parseError(error) });
    return c.json({ error: "Webhook run failed" }, 500);
  }
});
