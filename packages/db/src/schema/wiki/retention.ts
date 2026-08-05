import { sql } from "drizzle-orm";
import { index, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { legalHoldSubject } from "./enums";
import { organization, user } from "../auth";

/**
 * How long data lives in one organization, and what is exempt from that.
 *
 * Two tables, because they answer opposite questions:
 *
 *   organization_retention_setting — "how long does data live by default?"
 *                                    One row per org, owned by an admin.
 *   legal_hold                     — "this specific thing must not vanish."
 *                                    Many rows, each an exception that outranks
 *                                    every retention window.
 *
 * The purge runner reads both; nothing is deleted without consulting the holds
 * first. Enforcement deliberately lives in the API/runner layer and not in a
 * database trigger, so the same rule text is what the UI and the job execute.
 */

export const organizationRetentionSetting = wikiSchema.table(
  "organization_retention_setting",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Days audit rows are kept. NULL = forever, and that is the default on
     * purpose: silently dropping audit history because an update introduced a
     * window would destroy exactly the evidence the log exists to provide.
     * Shortening it is an explicit admin act — and one the log itself records.
     */
    auditRetentionDays: integer("audit_retention_days"),
    /** Days a trashed page/space stays restorable before it is purged for good. */
    trashRetentionDays: integer("trash_retention_days").notNull().default(30),
    /**
     * Lease marker for the purge runner. Set while a run owns this org and
     * cleared when it finishes; a stale claim (older than the lease window) is
     * reclaimable so a crashed run cannot strand an org forever. This is what
     * makes two overlapping ticks safe: the loser skips the org instead of
     * deleting the same rows a second time.
     */
    purgeClaimedAt: timestamp("purge_claimed_at", { withTimezone: true }),
    lastPurgeAt: timestamp("last_purge_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("org_retention_claim_idx").on(t.purgeClaimedAt)],
);

/**
 * "This must not disappear, whatever window applies."
 *
 * A hold names a subject rather than a row set, so a hold on a space keeps its
 * pages, comments, attachments and audit rows alive without one row per object.
 * Releasing is a separate, reasoned event: the row is kept (with `releasedAt`)
 * instead of deleted, because the fact that a hold once existed is itself
 * evidence.
 */
export const legalHold = wikiSchema.table(
  "legal_hold",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subject: legalHoldSubject("subject").notNull(),
    /**
     * The held object's id: a space id, a page id, or — for `organization` —
     * the org's own id. Deliberately *not* a foreign key: a hold must be able
     * to protect an object whose row a concurrent request is trying to remove,
     * and an `ON DELETE CASCADE` here would let a delete quietly take the hold
     * with it. Referential integrity is enforced when the hold is created.
     */
    subjectId: text("subject_id").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: text("released_by").references(() => user.id, { onDelete: "set null" }),
    /** Why the hold was lifted. Required by the API when releasing. */
    releaseReason: text("release_reason"),
    ...timestamps,
  },
  (t) => [
    // At most one *active* hold per subject. Released rows carry a non-null
    // `releasedAt`, and Postgres treats NULLs as distinct, so history
    // accumulates freely while a re-hold still cannot double up.
    uniqueIndex("legal_hold_active_uq")
      .on(t.subject, t.subjectId)
      .where(sql`released_at IS NULL`),
    index("legal_hold_org_idx").on(t.organizationId),
    index("legal_hold_subject_idx").on(t.subject, t.subjectId),
  ],
);
