import { and, eq, isNull, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { webhook, webhookDelivery } from "@nilovon-wiki/db/schema/index";

import type { ActivityAction } from "../activity";
import { isDeliverableAction } from "./events";

/**
 * Accepts a transaction as readily as the db handle — the whole point is that
 * the outbox rows land in the *caller's* transaction, so a rolled-back mutation
 * cannot leave an event queued for something that never happened.
 */
export type WebhookEnqueueExecutor = {
  select: Database["select"];
  insert: Database["insert"];
};

type EnqueueInput = {
  activityId: string;
  organizationId: string;
  spaceId: string | null;
  action: ActivityAction;
};

/**
 * Fans one audit row out to the subscriptions that asked for it, as `pending`
 * outbox rows. Returns how many were queued.
 *
 * The event filter runs in JavaScript rather than as a Postgres array predicate:
 * an organization has a handful of webhooks at most, the row is already in
 * memory, and keeping the matching rules in one readable place beats an
 * `@>`-with-enum-cast that behaves differently across drivers.
 */
export async function enqueueWebhookDeliveries(
  db: WebhookEnqueueExecutor,
  input: EnqueueInput,
  now: Date = new Date(),
): Promise<number> {
  // Managing webhooks is itself audited, but must never be delivered — a
  // subscription reporting its own edits would feed back into itself.
  if (!isDeliverableAction(input.action)) return 0;

  const subscriptions = await db
    .select({ id: webhook.id, events: webhook.events })
    .from(webhook)
    .where(
      and(
        eq(webhook.organizationId, input.organizationId),
        eq(webhook.active, true),
        // A space-scoped webhook only hears about its own space. An event with
        // no space (organization-level) reaches the unscoped webhooks only.
        input.spaceId
          ? or(isNull(webhook.spaceId), eq(webhook.spaceId, input.spaceId))
          : isNull(webhook.spaceId),
      ),
    );

  const matching = subscriptions.filter((row) => row.events.includes(input.action));
  if (matching.length === 0) return 0;

  await db.insert(webhookDelivery).values(
    matching.map((row) => ({
      webhookId: row.id,
      activityId: input.activityId,
      // Due immediately: the next tick after the commit picks it up.
      nextAttemptAt: now,
    })),
  );
  return matching.length;
}
