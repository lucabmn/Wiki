import { and, eq, inArray, lt, notInArray } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { activity } from "@nilovon-wiki/db/schema/index";

import type { ActivityAction } from "../activity";
import { isActivityHeld, type HoldScope } from "./holds";

/**
 * Actions the audit purge never removes, whatever window is configured.
 *
 * Without this, shortening the audit window would erase the record of who
 * shortened it — and the record that a deletion block once existed. Those two
 * facts are the ones an auditor asks for first, so they outlive the policy that
 * governs everything else. The set is small on purpose: it is an exception for
 * governance events, not a backdoor for keeping content history forever.
 */
export const PROTECTED_AUDIT_ACTIONS: ActivityAction[] = [
  "retention.updated",
  "retention.purged",
  "hold.created",
  "hold.released",
];

export type AuditPurgeResult = {
  deleted: number;
  /** Rows inside the window that a hold kept alive. */
  heldSkipped: number;
  /** True when the batch ceiling stopped the sweep early — more remains. */
  batchLimitReached: boolean;
};

/**
 * Deletes audit rows older than `cutoff` in one organization, at most
 * `batchLimit` of them.
 *
 * The ceiling is not a nicety: a first run against a log that has been growing
 * unbounded for a year would otherwise issue a single `DELETE` over millions of
 * rows, hold the locks for minutes and make the application unavailable while it
 * does. Whatever is left over is picked up by the next tick.
 *
 * Candidates are selected before being deleted rather than deleted by predicate,
 * because the hold rules are evaluated in application code — the same code the
 * request path uses — and because the count that gets logged has to be the count
 * that was actually removed.
 */
export async function purgeAuditRows(
  db: Database,
  input: {
    organizationId: string;
    cutoff: Date;
    batchLimit: number;
    holds: HoldScope;
  },
): Promise<AuditPurgeResult> {
  const { organizationId, cutoff, batchLimit, holds } = input;
  // A hold on the whole organization freezes its log entirely; no point paging
  // through candidates only to skip every one of them.
  if (holds.organization) {
    return { deleted: 0, heldSkipped: 0, batchLimitReached: false };
  }

  const candidates = await db
    .select({ id: activity.id, spaceId: activity.spaceId, pageId: activity.pageId })
    .from(activity)
    .where(
      and(
        eq(activity.organizationId, organizationId),
        lt(activity.createdAt, cutoff),
        // Expressed as an exclusion rather than an allow-list so an action added
        // to the enum later is purgeable by default; the opposite would grow an
        // ever-larger set of rows nothing ever cleans up.
        notInArray(activity.action, PROTECTED_AUDIT_ACTIONS),
      ),
    )
    .orderBy(activity.createdAt)
    .limit(batchLimit);

  const batchLimitReached = candidates.length === batchLimit;
  const removable = candidates.filter((row) => !isActivityHeld(holds, row));
  const heldSkipped = candidates.length - removable.length;
  if (removable.length === 0) {
    return { deleted: 0, heldSkipped, batchLimitReached };
  }

  const deleted = await db
    .delete(activity)
    .where(
      inArray(
        activity.id,
        removable.map((row) => row.id),
      ),
    )
    .returning({ id: activity.id });
  return { deleted: deleted.length, heldSkipped, batchLimitReached };
}
