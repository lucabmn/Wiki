import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";

import { deliverMail, isMailConfigured } from "@nilovon-wiki/auth/mail";
import type { Database } from "@nilovon-wiki/db";
import {
  digestDelivery,
  member,
  organization,
  user,
  userDigestSetting,
} from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { collectDigest } from "./collect";
import { renderDigestMail } from "./render";
import { computeNextRun } from "./schedule";
import {
  loadOrganizationDigestSettings,
  loadUserDigestOverride,
  resolveDigestPreferences,
  type UserDigestOverride,
} from "./settings";

/**
 * The digest runner.
 *
 * Two invariants carry the whole design:
 *
 *  1. **Work is claimed, never inferred from the clock.** Each recipient has a
 *     `digest_delivery` row with its own `next_run_at`; a run claims rows with a
 *     lease and clears it when done. Two server replicas, or a restart loop,
 *     therefore cannot send the same digest twice.
 *  2. **The window comes from the cursor, not from "the last 24 hours".** A run
 *     that is late — or that failed and retried — still reports exactly the
 *     events since the last *delivered* digest, because `cursor_at` only moves
 *     after a successful send.
 */

/** How long a claim is honoured before another run may steal the row. */
const CLAIM_LEASE_MS = 15 * 60 * 1000;

/** Recipients processed per run. Bounds how long one tick can take. */
export const DIGEST_BATCH_LIMIT = 100;

/** Members without a delivery row that one run adopts. */
const BACKFILL_LIMIT = 500;

const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Consecutive failures after which the window is given up on. Without this a
 * permanently undeliverable address (a closed mailbox) retries forever and its
 * cursor never moves, so the window grows without bound.
 */
const MAX_CONSECUTIVE_FAILURES = 8;

export type DigestRunSummary = {
  claimed: number;
  sent: number;
  /** Due, but the window held nothing and `skipIfEmpty` was on. */
  skippedEmpty: number;
  failed: number;
  /**
   * Rows removed because the recipient is no longer a member or has no address.
   * Counted apart from `failed`: this is routine cleanup, and folding it into
   * the failure count would make a departing colleague look like an outage.
   */
  dropped: number;
  /** Delivery rows created for members the runner had not seen before. */
  adopted: number;
  /** Set when the run did nothing because the install cannot send mail. */
  reason?: "smtp-not-configured";
};

type DeliveryKey = { userId: string; organizationId: string };

function keyOf(row: DeliveryKey): string {
  return `${row.userId}:${row.organizationId}`;
}

function deliveryMatches(row: DeliveryKey) {
  return and(
    eq(digestDelivery.userId, row.userId),
    eq(digestDelivery.organizationId, row.organizationId),
  );
}

/**
 * Gives every organization member a delivery row. Iterating *members* rather
 * than the settings table is what makes the admin defaults reach users who
 * never opened the settings page — those users have no `user_digest_setting`
 * row at all, and never will.
 */
async function backfillDeliveries(db: Database, now: Date): Promise<number> {
  const missing = await db
    .select({ userId: member.userId, organizationId: member.organizationId })
    .from(member)
    .leftJoin(
      digestDelivery,
      and(
        eq(digestDelivery.userId, member.userId),
        eq(digestDelivery.organizationId, member.organizationId),
      ),
    )
    .where(isNull(digestDelivery.userId))
    .limit(BACKFILL_LIMIT);
  if (missing.length === 0) return 0;

  const organizationIds = [...new Set(missing.map((row) => row.organizationId))];
  const organizationSettings = new Map(
    await Promise.all(
      organizationIds.map(
        async (id) => [id, await loadOrganizationDigestSettings(db, id)] as const,
      ),
    ),
  );
  const overrideRows = await db
    .select()
    .from(userDigestSetting)
    .where(inArray(userDigestSetting.organizationId, organizationIds));
  const overrides = new Map<string, UserDigestOverride>(
    overrideRows.map((row) => [keyOf(row), row as UserDigestOverride]),
  );

  const values = missing.map((row) => {
    const defaults = organizationSettings.get(row.organizationId)!;
    const preferences = resolveDigestPreferences(defaults, overrides.get(keyOf(row)) ?? null);
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      // Adopted now, so the first digest reports what happens from here on —
      // not the entire history of the wiki.
      cursorAt: now,
      nextRunAt: computeNextRun(preferences, now),
    };
  });
  await db.insert(digestDelivery).values(values).onConflictDoNothing();
  return values.length;
}

/**
 * Atomically claims up to `limit` due rows.
 *
 * The SELECT only proposes candidates; the UPDATE is the claim, because it
 * re-checks the same predicate while holding the row lock. A second runner that
 * proposed the same rows loses the race and simply gets fewer rows back.
 */
async function claimDue(
  db: Database,
  now: Date,
  limit: number,
): Promise<(typeof digestDelivery.$inferSelect)[]> {
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const claimable = or(isNull(digestDelivery.claimedAt), lt(digestDelivery.claimedAt, leaseCutoff));

  const candidates = await db
    .select({
      userId: digestDelivery.userId,
      organizationId: digestDelivery.organizationId,
    })
    .from(digestDelivery)
    .where(and(lte(digestDelivery.nextRunAt, now), claimable))
    .orderBy(asc(digestDelivery.nextRunAt))
    .limit(limit);
  if (candidates.length === 0) return [];

  return db
    .update(digestDelivery)
    .set({ claimedAt: now })
    .where(
      and(or(...candidates.map(deliveryMatches)), lte(digestDelivery.nextRunAt, now), claimable),
    )
    .returning();
}

/** Reschedules after a failed send, or gives the window up once retries run out. */
async function recordFailure(
  db: Database,
  row: DeliveryKey & { failureCount: number },
  now: Date,
  windowEnd: Date,
  error: string,
  nextRegularRun: Date | null,
): Promise<void> {
  const failureCount = row.failureCount + 1;
  if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
    // Give up on this window: move the cursor past it so the backlog stops
    // growing, and fall back onto the normal schedule.
    await db
      .update(digestDelivery)
      .set({
        cursorAt: windowEnd,
        nextRunAt: nextRegularRun,
        claimedAt: null,
        failureCount: 0,
        lastError: error,
      })
      .where(deliveryMatches(row));
    return;
  }
  const backoff = Math.min(RETRY_BASE_MS * 2 ** (failureCount - 1), RETRY_MAX_MS);
  await db
    .update(digestDelivery)
    .set({
      nextRunAt: new Date(now.getTime() + backoff),
      claimedAt: null,
      failureCount,
      lastError: error,
    })
    .where(deliveryMatches(row));
}

/**
 * Sends every digest that is due. Idempotent and safe to call concurrently —
 * both an in-process timer and an external cron may drive it.
 */
export async function runDueDigests(
  db: Database,
  options: { now?: Date; limit?: number } = {},
): Promise<DigestRunSummary> {
  const now = options.now ?? new Date();
  const summary: DigestRunSummary = {
    claimed: 0,
    sent: 0,
    skippedEmpty: 0,
    failed: 0,
    dropped: 0,
    adopted: 0,
  };

  // Without SMTP nothing can be delivered. Returning *before* claiming keeps
  // every cursor where it is, so configuring mail later loses no events.
  if (!isMailConfigured()) {
    return { ...summary, reason: "smtp-not-configured" };
  }

  summary.adopted = await backfillDeliveries(db, now);

  const claimed = await claimDue(db, now, options.limit ?? DIGEST_BATCH_LIMIT);
  summary.claimed = claimed.length;

  for (const row of claimed) {
    try {
      const outcome = await deliverDigest(db, row, now);
      if (outcome === "sent") summary.sent++;
      else if (outcome === "skipped") summary.skippedEmpty++;
      else if (outcome === "dropped") summary.dropped++;
      else summary.failed++;
    } catch (error) {
      summary.failed++;
      await recordFailure(
        db,
        row,
        now,
        now,
        error instanceof Error ? error.message : String(error),
        // The schedule could not be resolved here, so retry on backoff only.
        new Date(now.getTime() + RETRY_MAX_MS),
      );
    }
  }

  return summary;
}

type DeliverOutcome = "sent" | "skipped" | "failed" | "dropped";

async function deliverDigest(
  db: Database,
  row: typeof digestDelivery.$inferSelect,
  now: Date,
): Promise<DeliverOutcome> {
  const { userId, organizationId } = row;

  // Membership can end without the delivery row going with it (the row's
  // foreign keys point at the user and the org, not at the membership).
  const membership = await db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    columns: { id: true },
  });
  if (!membership) {
    await db.delete(digestDelivery).where(deliveryMatches(row));
    return "dropped";
  }

  const [organizationDefaults, override] = await Promise.all([
    loadOrganizationDigestSettings(db, organizationId),
    loadUserDigestOverride(db, userId, organizationId),
  ]);
  const preferences = resolveDigestPreferences(organizationDefaults, override);

  if (preferences.frequency === "off") {
    // Silenced between scheduling and running. Park the row and move the cursor
    // so re-enabling later does not replay everything that happened meanwhile.
    await db
      .update(digestDelivery)
      .set({ nextRunAt: null, cursorAt: now, claimedAt: null, failureCount: 0 })
      .where(deliveryMatches(row));
    return "skipped";
  }

  const nextRunAt = computeNextRun(preferences, now);
  const content = await collectDigest(db, {
    userId,
    organizationId,
    preferences,
    from: row.cursorAt,
    to: now,
  });

  if (content.entries.length === 0 && preferences.skipIfEmpty) {
    await db
      .update(digestDelivery)
      .set({ cursorAt: now, nextRunAt, claimedAt: null, failureCount: 0, lastError: null })
      .where(deliveryMatches(row));
    return "skipped";
  }

  const [recipient, organizationRow] = await Promise.all([
    db.query.user.findFirst({
      where: eq(user.id, userId),
      columns: { email: true, name: true },
    }),
    db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { name: true },
    }),
  ]);
  if (!recipient?.email) {
    await db.delete(digestDelivery).where(deliveryMatches(row));
    return "dropped";
  }

  const mail = renderDigestMail({
    organizationName: organizationRow?.name ?? env.APP_NAME,
    recipientName: recipient.name || null,
    appName: env.APP_NAME,
    webUrl: env.CORS_ORIGIN.replace(/\/+$/, ""),
    timezone: preferences.timezone,
    from: row.cursorAt,
    to: now,
    content,
  });

  const result = await deliverMail({ to: recipient.email, ...mail });
  if (!result.ok) {
    await recordFailure(db, row, now, now, result.error, nextRunAt);
    return "failed";
  }

  await db
    .update(digestDelivery)
    .set({
      cursorAt: now,
      lastSentAt: now,
      nextRunAt,
      claimedAt: null,
      failureCount: 0,
      lastError: null,
    })
    .where(deliveryMatches(row));
  return "sent";
}

/**
 * Recomputes when one recipient is next due. Call after their effective
 * schedule changed — otherwise a user who switches from monthly to daily waits
 * out the old schedule first.
 */
export async function rescheduleDigest(
  db: Database,
  userId: string,
  organizationId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const [organizationDefaults, override] = await Promise.all([
    loadOrganizationDigestSettings(db, organizationId),
    loadUserDigestOverride(db, userId, organizationId),
  ]);
  const preferences = resolveDigestPreferences(organizationDefaults, override);
  const nextRunAt = computeNextRun(preferences, now);

  await db
    .insert(digestDelivery)
    .values({ userId, organizationId, cursorAt: now, nextRunAt })
    .onConflictDoUpdate({
      target: [digestDelivery.userId, digestDelivery.organizationId],
      set: {
        nextRunAt,
        claimedAt: null,
        updatedAt: now,
        // Changing the *schedule* must not drop events that accumulated since
        // the last delivered digest — so the cursor normally stays put.
        // Switching digests **off** is different: it is a request to hear
        // nothing, and keeping the window open would mean the first mail after
        // re-enabling months later replays the whole backlog (truncated at that).
        // Same semantic as the `off` branch in `deliverDigest`.
        ...(nextRunAt === null ? { cursorAt: now } : {}),
      },
    });
  return nextRunAt;
}

/**
 * Reschedules everyone in an organization. Called when an admin changes the
 * defaults: users who inherit them must move to the new schedule immediately,
 * not after their next (old) run.
 */
export async function rescheduleOrganizationDigests(
  db: Database,
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  const [organizationDefaults, overrideRows, rows] = await Promise.all([
    loadOrganizationDigestSettings(db, organizationId),
    db.select().from(userDigestSetting).where(eq(userDigestSetting.organizationId, organizationId)),
    db
      .select({ userId: digestDelivery.userId })
      .from(digestDelivery)
      .where(eq(digestDelivery.organizationId, organizationId)),
  ]);
  const overrides = new Map<string, UserDigestOverride>(
    overrideRows.map((row) => [row.userId, row as UserDigestOverride]),
  );

  for (const row of rows) {
    const preferences = resolveDigestPreferences(
      organizationDefaults,
      overrides.get(row.userId) ?? null,
    );
    await db
      .update(digestDelivery)
      .set({ nextRunAt: computeNextRun(preferences, now), updatedAt: now })
      .where(deliveryMatches({ userId: row.userId, organizationId }));
  }
  return rows.length;
}
