import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { webhook, webhookDelivery } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { deliverWebhook, type DeliveryAttempt } from "./deliver";
import { buildEventPayload, buildPingPayload, type WebhookEventPayload } from "./payload";

/**
 * The webhook runner: drains the outbox `recordActivity` fills.
 *
 * One invariant carries the design, the same one the digest runner rests on:
 * **work is claimed in the database, never inferred from the clock.** A run
 * marks the rows it took with a lease and clears it when done, so the in-process
 * ticker and an external `POST /internal/webhooks/run` may both be active
 * without any event being delivered twice. A crashed run strands nothing — its
 * lease expires and the next run reclaims the row.
 */

/** How long a claim is honoured before another run may steal the row. */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** Deliveries handled per run. Bounds how long one tick can take. */
export const WEBHOOK_BATCH_LIMIT = 50;

/** First retry delay; doubles per attempt up to the cap. */
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export type WebhookRunSummary = {
  claimed: number;
  delivered: number;
  /** Failed this round, but scheduled for another attempt. */
  retrying: number;
  /** Out of attempts, or undeliverable — terminal. */
  failed: number;
};

type Send = (input: {
  url: string;
  secret: string;
  payload: WebhookEventPayload;
  attempt: number;
}) => Promise<DeliveryAttempt>;

type RunOptions = {
  now?: Date;
  limit?: number;
  /** Swappable so tests exercise the claim/retry logic without a network. */
  send?: Send;
};

/**
 * Atomically claims up to `limit` due deliveries.
 *
 * The SELECT only proposes candidates; the UPDATE is the claim, because it
 * re-checks the same predicate while holding the row lock. A second runner that
 * proposed the same rows loses the race and simply gets fewer rows back.
 */
async function claimDue(
  db: Database,
  now: Date,
  limit: number,
): Promise<(typeof webhookDelivery.$inferSelect)[]> {
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const claimable = and(
    eq(webhookDelivery.status, "pending"),
    lte(webhookDelivery.nextAttemptAt, now),
    or(isNull(webhookDelivery.claimedAt), lt(webhookDelivery.claimedAt, leaseCutoff)),
  );

  const candidates = await db
    .select({ id: webhookDelivery.id })
    .from(webhookDelivery)
    .where(claimable)
    .orderBy(asc(webhookDelivery.nextAttemptAt))
    .limit(limit);
  if (candidates.length === 0) return [];

  return db
    .update(webhookDelivery)
    .set({ claimedAt: now })
    .where(
      and(
        inArray(
          webhookDelivery.id,
          candidates.map((row) => row.id),
        ),
        claimable,
      ),
    )
    .returning();
}

/** Sends every due delivery. Idempotent and safe to run concurrently. */
export async function runDueWebhooks(
  db: Database,
  options: RunOptions = {},
): Promise<WebhookRunSummary> {
  const now = options.now ?? new Date();
  const send = options.send ?? deliverWebhook;
  const summary: WebhookRunSummary = { claimed: 0, delivered: 0, retrying: 0, failed: 0 };

  const claimed = await claimDue(db, now, options.limit ?? WEBHOOK_BATCH_LIMIT);
  summary.claimed = claimed.length;

  for (const row of claimed) {
    const outcome = await processDelivery(db, row, now, send);
    if (outcome === "delivered") summary.delivered++;
    else if (outcome === "retrying") summary.retrying++;
    else summary.failed++;
  }
  return summary;
}

type Outcome = "delivered" | "retrying" | "failed";

async function processDelivery(
  db: Database,
  row: typeof webhookDelivery.$inferSelect,
  now: Date,
  send: Send,
): Promise<Outcome> {
  const subscription = await db.query.webhook.findFirst({
    where: eq(webhook.id, row.webhookId),
  });
  if (!subscription) {
    return settle(db, row, now, "Webhook existiert nicht mehr.", null);
  }
  if (!subscription.active) {
    // Paused after the event was queued. Terminal rather than parked: the
    // history should say why nothing arrived, and replaying a week of events
    // when someone re-enables the webhook is not what "pause" means.
    return settle(db, row, now, "Webhook war zum Sendezeitpunkt deaktiviert.", null);
  }

  const payload = row.activityId
    ? await buildEventPayload(db, { deliveryId: row.id, activityId: row.activityId })
    : null;
  if (!payload) {
    return settle(db, row, now, "Das zugehörige Ereignis ist nicht mehr verfügbar.", null);
  }

  const attempt = row.attempts + 1;
  let result: DeliveryAttempt;
  try {
    result = await send({
      url: subscription.url,
      secret: subscription.secret,
      payload,
      attempt,
    });
  } catch (error) {
    // `deliverWebhook` swallows its own errors; this catches a broken injected
    // sender so one bad row cannot abort the whole batch.
    result = {
      ok: false,
      responseStatus: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (result.ok) {
    await db
      .update(webhookDelivery)
      .set({
        status: "delivered",
        attempts: attempt,
        deliveredAt: now,
        responseStatus: result.responseStatus,
        nextAttemptAt: null,
        claimedAt: null,
        lastError: null,
      })
      .where(eq(webhookDelivery.id, row.id));
    return "delivered";
  }

  if (attempt >= env.WEBHOOK_MAX_ATTEMPTS) {
    await db
      .update(webhookDelivery)
      .set({
        status: "failed",
        attempts: attempt,
        responseStatus: result.responseStatus,
        nextAttemptAt: null,
        claimedAt: null,
        lastError: result.error,
      })
      .where(eq(webhookDelivery.id, row.id));
    return "failed";
  }

  const backoff = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
  await db
    .update(webhookDelivery)
    .set({
      status: "pending",
      attempts: attempt,
      responseStatus: result.responseStatus,
      nextAttemptAt: new Date(now.getTime() + backoff),
      claimedAt: null,
      lastError: result.error,
    })
    .where(eq(webhookDelivery.id, row.id));
  return "retrying";
}

/** Marks a delivery terminally undeliverable — nothing here is worth retrying. */
async function settle(
  db: Database,
  row: typeof webhookDelivery.$inferSelect,
  now: Date,
  error: string,
  responseStatus: number | null,
): Promise<Outcome> {
  await db
    .update(webhookDelivery)
    .set({
      status: "failed",
      attempts: row.attempts + 1,
      responseStatus,
      nextAttemptAt: null,
      claimedAt: null,
      lastError: error,
      updatedAt: now,
    })
    .where(eq(webhookDelivery.id, row.id));
  return "failed";
}

/**
 * The "Test senden" button's one-off ping.
 *
 * Sent synchronously rather than queued: the admin is watching the dialog and
 * needs the receiver's answer now, not on the next tick. It is still written to
 * the delivery log — a test that fails must be as inspectable as a real event —
 * but never in `pending` state, so the runner has no reason to touch it.
 */
export async function sendTestDelivery(
  db: Database,
  input: {
    webhook: typeof webhook.$inferSelect;
    organization: { id: string; name: string };
    actor: { id: string; name: string } | null;
    send?: Send;
  },
): Promise<typeof webhookDelivery.$inferSelect> {
  const now = new Date();
  const [row] = await db
    .insert(webhookDelivery)
    .values({ webhookId: input.webhook.id, activityId: null, nextAttemptAt: null })
    .returning();
  if (!row) throw new Error("Test-Zustellung konnte nicht angelegt werden");

  const payload = buildPingPayload({
    deliveryId: row.id,
    organization: input.organization,
    actor: input.actor,
    at: now,
  });
  const result = await (input.send ?? deliverWebhook)({
    url: input.webhook.url,
    secret: input.webhook.secret,
    payload,
    attempt: 1,
  });

  const [settled] = await db
    .update(webhookDelivery)
    .set({
      status: result.ok ? "delivered" : "failed",
      attempts: 1,
      deliveredAt: result.ok ? now : null,
      responseStatus: result.responseStatus,
      lastError: result.error,
    })
    .where(eq(webhookDelivery.id, row.id))
    .returning();
  return settled ?? row;
}
