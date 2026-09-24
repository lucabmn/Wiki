import { runDueWebhooks } from "@nilovon-wiki/api/lib/webhooks/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { Hono } from "hono";

import { createScheduledRunner } from "./scheduled-runner";

/**
 * Drives the outbound-webhook runner.
 *
 * Same shape as the digest runner next door (see `./scheduled-runner`).
 * `runDueWebhooks` claims its work in the database, so both triggers may be
 * active at once without any event being delivered twice.
 */
const runner = createScheduledRunner({
  source: "webhooks",
  label: "webhook run",
  enabled: env.WEBHOOK_SCHEDULER_ENABLED,
  intervalSeconds: env.WEBHOOK_TICK_SECONDS,
  run: () => runDueWebhooks(db),
  // Idle ticks are the common case and would drown the log; report only runs
  // that actually moved something.
  shouldLog: (summary) => summary.claimed > 0,
  failureMessage: "Webhook run failed",
});

export const startWebhookScheduler = runner.start;
export const stopWebhookScheduler = runner.stop;

export const webhookRoutes = new Hono();
webhookRoutes.post("/webhooks/run", runner.handleRun);
