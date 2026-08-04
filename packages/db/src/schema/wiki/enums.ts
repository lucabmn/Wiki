import { wikiSchema } from "./_schema";

export const spaceVisibility = wikiSchema.enum("space_visibility", [
  "public", // any org member can read; space_member rows grant elevated roles
  "private", // only explicit members (users/teams) in space_member
  "restricted", // the creator + explicit members
]);

export const pageStatus = wikiSchema.enum("page_status", [
  "draft", // only the creator can see it
  "published", // everyone with access to the space can see it
  "archived", // only the creator + explicit members can see it
]);

export const activityAction = wikiSchema.enum("activity_action", [
  "space.created",
  "space.updated",
  "space.archived",
  "space.deleted",
  "page.created",
  "page.updated",
  "page.published",
  "page.moved",
  "page.archived",
  "page.restored",
  "page.deleted",
  "comment.created",
  "comment.resolved",
  "comment.deleted",
  "attachment.uploaded",
  "attachment.deleted",
  // Webhook configuration is itself auditable. These three are deliberately
  // *not* deliverable over webhooks (see `enqueueWebhookDeliveries`): a webhook
  // reporting its own creation would loop, and the row carries the endpoint.
  "webhook.created",
  "webhook.updated",
  "webhook.deleted",
  // Instance-admin events are logged in `admin.admin_audit`, but these two are
  // mirrored here as well: someone whose account was used has a right to see it
  // in their own feed, not only in a log they cannot open.
  "impersonation.started",
  "impersonation.ended",
]);

export const wikiRole = wikiSchema.enum("wiki_role", ["viewer", "commenter", "editor", "admin"]);

/**
 * Lifecycle of one queued webhook POST. `failed` is terminal — it means the
 * attempt ceiling ran out, not that a single attempt errored; a retryable
 * failure stays `pending` with a later `next_attempt_at`.
 */
export const webhookDeliveryStatus = wikiSchema.enum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

// ── Bundled ("digest") notifications ────────────────────────────────────────

export const digestFrequency = wikiSchema.enum("digest_frequency", [
  "off", // no digest at all — the switch a user or admin flips to stay silent
  "daily",
  "weekly", // on `weekday`
  "monthly", // on `day_of_month`
]);

// Which slice of the organization a digest reports on.
export const digestScope = wikiSchema.enum("digest_scope", [
  "organization", // everything the recipient may read
  "my_spaces", // only spaces they are an explicit member of (or created)
  "subscribed", // only watched pages and favorites
]);

/**
 * Coarse groupings of `activity_action`. Recipients pick categories, not raw
 * actions: the action list is an implementation detail that grows with the
 * product, and a stored subscription must not silently miss new actions.
 * The action -> category mapping lives in the API layer.
 */
export const digestCategory = wikiSchema.enum("digest_category", [
  "pages_created",
  "pages_updated",
  "pages_removed",
  "comments",
  "attachments",
  "spaces",
]);

// How a user's row relates to the organization defaults.
export const digestMode = wikiSchema.enum("digest_mode", [
  "inherit", // follow the admin defaults, including later changes to them
  "custom", // this row's own columns win
]);

// `role` grants a space/page to everyone holding a given org role (a "group").
export const permissionSubject = wikiSchema.enum("permission_subject", ["user", "team", "role"]);
