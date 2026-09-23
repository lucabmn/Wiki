import { runDueDigests } from "@nilovon-wiki/api/lib/notifications/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { Hono } from "hono";

import { createScheduledRunner } from "./scheduled-runner";

/**
 * Drives the bundled-notification (digest) runner.
 *
 * Two triggers, one runner (see `./scheduled-runner`). `runDueDigests` claims
 * its work in the database, so both may be active at once without sending
 * anything twice.
 *
 * Nothing here decides *who* gets what — that lives in the API package next to
 * the access-control helpers it has to reuse.
 */
const runner = createScheduledRunner({
  source: "digests",
  label: "digest run",
  enabled: env.DIGEST_SCHEDULER_ENABLED,
  intervalSeconds: env.DIGEST_TICK_SECONDS,
  run: () => runDueDigests(db),
  // Quiet ticks are the common case; only log when something happened or the
  // install is misconfigured, so the log stays readable.
  shouldLog: (summary) => summary.claimed > 0 || summary.adopted > 0 || !!summary.reason,
  failureMessage: "Digest run failed",
});

export const startDigestScheduler = runner.start;
export const stopDigestScheduler = runner.stop;

export const digestRoutes = new Hono();
digestRoutes.post("/digests/run", runner.handleRun);
