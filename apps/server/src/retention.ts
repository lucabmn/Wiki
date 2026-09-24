import { runRetention } from "@nilovon-wiki/api/lib/retention/run";
import { db } from "@nilovon-wiki/db";
import { env } from "@nilovon-wiki/env/server";
import { Hono } from "hono";

import { createScheduledRunner } from "./scheduled-runner";

/**
 * Drives the data-retention runner: the audit window and the trash expiry.
 *
 * Two triggers, one runner — the same arrangement the digest runner uses (see
 * `./scheduled-runner`). `runRetention` claims each organization in the
 * database, so both may be active at once (and several replicas may run)
 * without deleting anything twice.
 *
 * Nothing here decides *what* may be deleted. That lives in the API package,
 * next to the deletion-block rules the request path has to reuse — two copies of
 * that decision is precisely how a purge job ends up removing something a user
 * was told was protected.
 *
 * The HTTP trigger shares `checkInternalToken` with the digest and webhook
 * runners: they are one trust boundary, and a third secret would only be a third
 * thing to rotate and forget.
 */
const runner = createScheduledRunner({
  source: "retention",
  label: "retention run",
  enabled: env.RETENTION_SCHEDULER_ENABLED,
  intervalSeconds: env.RETENTION_TICK_SECONDS,
  run: () => runRetention(db, { batchLimit: env.RETENTION_BATCH_LIMIT }),
  // Deletions are always logged, with a count per category — an operator has
  // to be able to answer "what did the job remove last night?" from the logs
  // alone. Quiet runs stay silent so the log remains readable.
  shouldLog: (summary) => {
    const removed =
      summary.auditDeleted + summary.pagesPurged + summary.spacesPurged + summary.attachmentsPurged;
    return removed > 0 || summary.heldSkipped > 0 || summary.pending > 0;
  },
  failureMessage: "Retention run failed",
});

export const startRetentionScheduler = runner.start;
export const stopRetentionScheduler = runner.stop;

export const retentionRoutes = new Hono();
retentionRoutes.post("/retention/run", runner.handleRun);
