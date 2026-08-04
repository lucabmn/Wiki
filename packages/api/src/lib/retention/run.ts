import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { organization } from "@nilovon-wiki/db/schema/auth";
import { organizationRetentionSetting } from "@nilovon-wiki/db/schema/index";

import { recordActivity } from "../activity";
import { loadHoldScope } from "./holds";
import { purgeAuditRows } from "./purge-audit";
import { purgeExpiredTrash } from "./purge-trash";
import { auditCutoff, ensureRetentionRows, trashCutoff } from "./settings";

/**
 * The retention runner: one job that enforces every window, for every
 * organization.
 *
 * Deliberately *one* job. Audit retention and trash expiry share the deletion
 * block rules and the batch ceiling, and two jobs would inevitably disagree
 * about what may be removed — the one with the looser rules winning by deleting
 * first.
 */

/** Rows removed per category, per run. Sized so a run stays well under a tick. */
export const DEFAULT_BATCH_LIMIT = 1000;

/**
 * How long a claim is honoured before another run may take the organization
 * over. Long enough that a slow but healthy run is never overtaken, short
 * enough that a crashed process does not freeze an org until someone notices.
 */
export const CLAIM_LEASE_MS = 15 * 60 * 1000;

export type RetentionRunSummary = {
  /** Organizations this run actually claimed and processed. */
  processed: number;
  /** Organizations another run held a claim on. Not an error — the work is theirs. */
  skippedClaimed: number;
  auditDeleted: number;
  pagesPurged: number;
  spacesPurged: number;
  attachmentsPurged: number;
  heldSkipped: number;
  pending: number;
  /** True when a ceiling stopped a sweep early; the next tick continues. */
  batchLimitReached: boolean;
};

const EMPTY_SUMMARY: RetentionRunSummary = {
  processed: 0,
  skippedClaimed: 0,
  auditDeleted: 0,
  pagesPurged: 0,
  spacesPurged: 0,
  attachmentsPurged: 0,
  heldSkipped: 0,
  pending: 0,
  batchLimitReached: false,
};

export async function runRetention(
  db: Database,
  options: { now?: Date; batchLimit?: number; leaseMs?: number } = {},
): Promise<RetentionRunSummary> {
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const leaseMs = options.leaseMs ?? CLAIM_LEASE_MS;

  const organizations = await db.select({ id: organization.id }).from(organization);
  if (organizations.length === 0) return EMPTY_SUMMARY;
  // Every org needs a policy row, because the row is also what a run claims.
  // Without one, an org that never opened the settings page would never have its
  // trash expire.
  await ensureRetentionRows(
    db,
    organizations.map((row) => row.id),
  );

  const summary: RetentionRunSummary = { ...EMPTY_SUMMARY };
  for (const { id: organizationId } of organizations) {
    const policy = await claimOrganization(db, organizationId, now, leaseMs);
    if (!policy) {
      summary.skippedClaimed += 1;
      continue;
    }
    try {
      await purgeOrganization(db, { organizationId, policy, now, batchLimit }, summary);
      summary.processed += 1;
    } finally {
      await releaseClaim(db, organizationId, now);
    }
  }
  return summary;
}

type ClaimedPolicy = { auditRetentionDays: number | null; trashRetentionDays: number };

/**
 * Takes ownership of one organization for this run, atomically.
 *
 * This single conditional UPDATE is what makes overlapping runs safe. Two ticks
 * racing on the same org both issue it; Postgres serialises them on the row, so
 * exactly one sees a claimable row and gets a result back. The loser gets
 * nothing and moves on — it does not delete the same rows a second time, and it
 * does not wait either. An in-process `running` flag alone could not do this:
 * it says nothing about the other replica.
 */
async function claimOrganization(
  db: Database,
  organizationId: string,
  now: Date,
  leaseMs: number,
): Promise<ClaimedPolicy | null> {
  const staleBefore = new Date(now.getTime() - leaseMs);
  const rows = await db
    .update(organizationRetentionSetting)
    .set({ purgeClaimedAt: now })
    .where(
      and(
        eq(organizationRetentionSetting.organizationId, organizationId),
        or(
          isNull(organizationRetentionSetting.purgeClaimedAt),
          lt(organizationRetentionSetting.purgeClaimedAt, staleBefore),
        ),
      ),
    )
    .returning({
      auditRetentionDays: organizationRetentionSetting.auditRetentionDays,
      trashRetentionDays: organizationRetentionSetting.trashRetentionDays,
    });
  return rows[0] ?? null;
}

async function releaseClaim(db: Database, organizationId: string, now: Date): Promise<void> {
  await db
    .update(organizationRetentionSetting)
    .set({ purgeClaimedAt: null, lastPurgeAt: now })
    .where(eq(organizationRetentionSetting.organizationId, organizationId));
}

async function purgeOrganization(
  db: Database,
  input: {
    organizationId: string;
    policy: ClaimedPolicy;
    now: Date;
    batchLimit: number;
  },
  summary: RetentionRunSummary,
): Promise<void> {
  const { organizationId, policy, now, batchLimit } = input;
  // Resolved once per organization and handed to both sweeps, so the audit purge
  // and the trash expiry can never disagree about what is protected.
  const holds = await loadHoldScope(db, organizationId);
  // Counted per organization, not on the shared summary: the audit row below
  // reports what *this* org lost, and a cumulative number would be a lie in
  // every install with more than one tenant.
  const own: Omit<RetentionRunSummary, "processed" | "skippedClaimed"> = {
    auditDeleted: 0,
    pagesPurged: 0,
    spacesPurged: 0,
    attachmentsPurged: 0,
    heldSkipped: 0,
    pending: 0,
    batchLimitReached: false,
  };

  // A null window means "keep forever" and must delete nothing at all — not
  // "keep for 0 days", which is the mistake that would empty an audit log.
  if (policy.auditRetentionDays !== null) {
    const audit = await purgeAuditRows(db, {
      organizationId,
      cutoff: auditCutoff(now, policy.auditRetentionDays),
      batchLimit,
      holds,
    });
    own.auditDeleted = audit.deleted;
    own.heldSkipped += audit.heldSkipped;
    own.batchLimitReached ||= audit.batchLimitReached;
  }

  const trash = await purgeExpiredTrash(db, {
    organizationId,
    cutoff: trashCutoff(now, policy.trashRetentionDays),
    batchLimit,
    holds,
  });
  own.pagesPurged = trash.pagesPurged;
  own.spacesPurged = trash.spacesPurged;
  own.attachmentsPurged = trash.attachmentsPurged;
  own.heldSkipped += trash.heldSkipped;
  own.pending = trash.pending;
  own.batchLimitReached ||= trash.batchLimitReached;

  await recordRunAudit(db, organizationId, own);

  summary.auditDeleted += own.auditDeleted;
  summary.pagesPurged += own.pagesPurged;
  summary.spacesPurged += own.spacesPurged;
  summary.attachmentsPurged += own.attachmentsPurged;
  summary.heldSkipped += own.heldSkipped;
  summary.pending += own.pending;
  summary.batchLimitReached ||= own.batchLimitReached;
}

/**
 * One audit row per organization a run actually removed something from. Quiet
 * runs write nothing — a log filled with "deleted 0 rows" every five minutes is
 * a log nobody reads. This row is itself exempt from the audit window.
 */
async function recordRunAudit(
  db: Database,
  organizationId: string,
  own: Omit<RetentionRunSummary, "processed" | "skippedClaimed">,
): Promise<void> {
  const removed = own.auditDeleted + own.pagesPurged + own.spacesPurged + own.attachmentsPurged;
  if (removed === 0) return;
  await recordActivity(db, {
    organizationId,
    action: "retention.purged",
    metadata: {
      auditDeleted: own.auditDeleted,
      pagesPurged: own.pagesPurged,
      spacesPurged: own.spacesPurged,
      attachmentsPurged: own.attachmentsPurged,
      heldSkipped: own.heldSkipped,
    },
  });
}
