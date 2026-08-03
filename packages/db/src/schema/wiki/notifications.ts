import { boolean, index, integer, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { timestamps } from "../_helpers";
import { digestCategory, digestFrequency, digestMode, digestScope } from "./enums";
import { organization, user } from "../auth";

/**
 * Bundled ("digest") notifications: instead of a mail per event, every recipient
 * gets one mail per period summarising what changed.
 *
 * Three tables, because the three concerns have different lifetimes:
 *
 *   organization_digest_setting — the admin's defaults, one row per org.
 *   user_digest_setting         — sparse. A row exists only once a user has
 *                                 actually customised something; its absence
 *                                 *is* "inherit", so changing the org defaults
 *                                 moves everyone who never opted out.
 *   digest_delivery             — dense machine state (when is this recipient
 *                                 next due, which events have they already
 *                                 seen). Owned by the runner, safe to wipe:
 *                                 it is rebuilt from the member list.
 *
 * Splitting delivery state out is what makes the "no row = inherit" invariant
 * hold. If scheduling lived on `user_digest_setting`, the runner would have to
 * create a row for every member and the distinction would be lost.
 */

// The per-period schedule and content filter. Shared, column for column, by the
// org defaults and the user override — `resolveDigestSettings` in the API layer
// COALESCEs one over the other, so the shapes must stay identical.
const digestPreferenceColumns = {
  frequency: digestFrequency("frequency"),
  /** Local hour of day (0-23) the digest is sent at. */
  hour: integer("hour"),
  /** Weekly schedules only: 0 = Sunday … 6 = Saturday. */
  weekday: integer("weekday"),
  /** Monthly schedules only. Capped at 28 so no month is ever skipped. */
  dayOfMonth: integer("day_of_month"),
  /** IANA zone (e.g. `Europe/Berlin`) the hour/weekday/day are interpreted in. */
  timezone: text("timezone"),
  categories: digestCategory("categories").array(),
  scope: digestScope("scope"),
  /** Suppress the mail entirely when the period produced no matching events. */
  skipIfEmpty: boolean("skip_if_empty"),
  /** Include the recipient's own edits. Off by default — nobody needs a report
   *  of what they did themselves. */
  includeOwnActivity: boolean("include_own_activity"),
};

export const organizationDigestSetting = wikiSchema.table("organization_digest_setting", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  // Not null here: the org row is the fallback of last resort, so every column
  // must carry a value. The user override below keeps the same columns nullable.
  frequency: digestFrequency("frequency").notNull().default("weekly"),
  hour: integer("hour").notNull().default(8),
  weekday: integer("weekday").notNull().default(1),
  dayOfMonth: integer("day_of_month").notNull().default(1),
  timezone: text("timezone").notNull().default("UTC"),
  categories: digestCategory("categories")
    .array()
    .notNull()
    .default(["pages_created", "pages_updated", "comments"]),
  scope: digestScope("scope").notNull().default("organization"),
  skipIfEmpty: boolean("skip_if_empty").notNull().default(true),
  includeOwnActivity: boolean("include_own_activity").notNull().default(false),
  /**
   * When false, user overrides are ignored and everyone runs on the defaults.
   * Existing override rows are kept, not deleted, so re-enabling restores them.
   */
  allowUserOverride: boolean("allow_user_override").notNull().default(true),
  ...timestamps,
});

export const userDigestSetting = wikiSchema.table(
  "user_digest_setting",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mode: digestMode("mode").notNull().default("inherit"),
    // Null means "take the organization's value for this one field", so a user
    // can override only the send time and still follow the admin's categories.
    ...digestPreferenceColumns,
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.organizationId] }),
    index("user_digest_setting_org_idx").on(t.organizationId),
  ],
);

/**
 * One row per (member, org) the runner has seen. `cursorAt` is the exclusive
 * lower bound of the next digest's window — advancing it only after a
 * successful send is what keeps a failed or delayed run from dropping events.
 */
export const digestDelivery = wikiSchema.table(
  "digest_delivery",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Null while the recipient's schedule is `off`; set again when re-enabled. */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    /** Events at or before this instant have already been reported. */
    cursorAt: timestamp("cursor_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    /**
     * Lease marker. Set when a runner claims the row and cleared when it is
     * done; a stale claim (older than the lease window) is reclaimable so a
     * crashed run does not strand a recipient forever.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Consecutive send failures — drives the retry backoff. */
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.organizationId] }),
    // The runner's hot path: "which rows are due?" — ordered by due time.
    index("digest_delivery_due_idx").on(t.nextRunAt),
  ],
);
