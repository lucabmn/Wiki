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
 * Known gap, inherited from the audit log itself: ACL and membership changes and
 * comment *edits* do not call `recordActivity` today, so no webhook can report
 * them. The list below is exhaustive — it is not "everything that happens".
 */
export const DELIVERABLE_ACTIONS: readonly ActivityAction[] = ActivityActionSchema.options.filter(
  (action) => !action.startsWith("webhook."),
);

const DELIVERABLE = new Set<string>(DELIVERABLE_ACTIONS);

export function isDeliverableAction(action: string): boolean {
  return DELIVERABLE.has(action);
}
