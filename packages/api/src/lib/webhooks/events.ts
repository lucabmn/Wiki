import { ActivityActionSchema } from "../../schemas/misc";
import type { ActivityAction } from "../activity";

/**
 * Which audit actions may be delivered to a webhook.
 *
 * `webhook.*` is excluded on purpose, and the exclusion is enforced in two
 * places (here for the subscription UI, and again in `enqueueWebhookDeliveries`
 * for the fan-out): a webhook that reports changes to webhooks would deliver its
 * own creation, and editing a subscription in response to that delivery would
 * loop. The rows are still written to the audit log — they are just not events
 * anyone can subscribe to.
 *
 * Access-control changes (`space.member_*`, `page.member_*`,
 * `page.access_changed`) and comment edits are included: they are audited, and
 * an integration that watches who gains access to what is a legitimate — and
 * frequently the most important — reason to subscribe.
 *
 * The list is derived from the action enum, so a new audited action becomes
 * deliverable automatically. Anything that must not be is excluded here
 * explicitly, as `webhook.*` is.
 */
export const DELIVERABLE_ACTIONS: readonly ActivityAction[] = ActivityActionSchema.options.filter(
  (action) => !action.startsWith("webhook."),
);

const DELIVERABLE = new Set<string>(DELIVERABLE_ACTIONS);

export function isDeliverableAction(action: string): boolean {
  return DELIVERABLE.has(action);
}
