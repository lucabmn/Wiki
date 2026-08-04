import { boolean, index, integer, text, timestamp } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { activityAction, webhookDeliveryStatus } from "./enums";
import { space } from "./spaces";
import { activity } from "./activity";
import { organization, user } from "../auth";

/**
 * Outbound webhooks — the first way events leave this system.
 *
 * Two tables, because delivery is deliberately *not* part of the mutation that
 * produced the event:
 *
 *   webhook          — the subscription an org admin configured. Long-lived,
 *                      edited by hand, one row per endpoint.
 *   webhook_delivery — the outbox. `recordActivity` appends one row per matching
 *                      subscription **inside the mutation's transaction**, so a
 *                      rolled-back write leaves no delivery behind and a dead
 *                      receiver can never block a page save. A runner drains the
 *                      table after the commit.
 *
 * The delivery row stores only *which* activity to report, never a rendered
 * payload: the runner resolves names and titles at send time, so a payload shape
 * that changes does not need a migration of queued rows.
 */

export const webhook = wikiSchema.table(
  "webhook",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Human-readable label, shown in the settings list and the delivery log. */
    name: text("name").notNull(),
    /** `http(s)` only — validated through `normalizeExternalUrl` before insert. */
    url: text("url").notNull(),
    /**
     * HMAC key for `X-Wiki-Signature`. Stored in the clear because signing needs
     * the key itself; returned to the client exactly once, at creation.
     */
    secret: text("secret").notNull(),
    /** Subscribed actions. Empty is not allowed — a webhook must want something. */
    events: activityAction("events").array().notNull(),
    /** Null = every space in the organization, including ones created later. */
    spaceId: text("space_id").references(() => space.id, { onDelete: "cascade" }),
    /**
     * Paused rather than deleted: the delivery history stays readable, and a
     * receiver under maintenance can be silenced without re-entering its secret.
     */
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // The fan-out path in `recordActivity`: every mutation asks this, so it has
    // to be an index hit even when the organization has no webhooks at all.
    index("webhook_org_active_idx").on(t.organizationId, t.active),
  ],
);

export const webhookDelivery = wikiSchema.table(
  "webhook_delivery",
  {
    id: id(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    /**
     * The audit row this delivery reports. Nullable on delete so a pruned
     * activity log does not take the delivery history with it — the runner skips
     * a claimed row whose activity has since vanished.
     */
    activityId: text("activity_id").references(() => activity.id, { onDelete: "set null" }),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** When the next attempt becomes due. Null once the row is settled. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /**
     * Lease marker, same mechanic as `digest_delivery.claimedAt`: set when a
     * runner claims the row, cleared when it is done. A stale claim is
     * reclaimable, so a crashed run does not strand an event forever.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastError: text("last_error"),
    responseStatus: integer("response_status"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // The runner claims on exactly this pair, ordered by due time.
    index("webhook_delivery_due_idx").on(t.status, t.nextAttemptAt),
    // The settings page reads one webhook's most recent attempts.
    index("webhook_delivery_webhook_idx").on(t.webhookId, t.createdAt),
  ],
);
