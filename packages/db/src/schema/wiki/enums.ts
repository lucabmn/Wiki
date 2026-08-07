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
  "space.restored",
  "space.deleted", // moved to the trash — recoverable until it expires
  "space.untrashed",
  "space.purged", // gone for good, from the trash or by an admin
  "page.created",
  "page.updated",
  "page.published",
  "page.moved",
  "page.archived",
  "page.restored",
  "page.deleted", // moved to the trash — recoverable until it expires
  "page.untrashed",
  "page.purged",
  "comment.created",
  // An edit can change what a comment says after somebody replied to it or
  // acted on it. The row records that it happened and by whom, never the body.
  "comment.updated",
  "comment.resolved",
  "comment.deleted",
  "attachment.uploaded",
  "attachment.deleted",
  // ── Access control ────────────────────────────────────────────────────────
  // Who could see what, and since when, is the question an audit log exists to
  // answer. Without these a grant could be added and removed again between two
  // reads of the members list and leave nothing behind at all.
  //
  // The metadata denormalizes the grantee (id, display name, and the address
  // for a user grant), because the membership row is gone by the time anybody
  // reads the log — the same reason `page.deleted` carries the page title.
  "space.member_added",
  "space.member_role_changed",
  "space.member_removed",
  // The page's own visibility override, which is what decides whether the page
  // ACL applies at all. Records both sides: "restricted" alone does not say
  // whether access was tightened or loosened.
  "page.access_changed",
  "page.member_added",
  "page.member_role_changed",
  "page.member_removed",
  // Org-wide security policy. Auditable because turning the requirement off is
  // the interesting event: it silently restores access for every member who
  // never set up a second factor.
  "organization.two_factor_enabled",
  "organization.two_factor_disabled",
  "organization.two_factor_grace_updated",
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
  // ── Data lifecycle ────────────────────────────────────────────────────────
  // These four are never removed by the audit-retention purge itself: a
  // shortened window that erased the record of who shortened it, or of a
  // deletion block, would defeat the purpose of keeping an audit log at all.
  "retention.updated",
  "retention.purged",
  "hold.created",
  "hold.released",
]);

/**
 * What a deletion block ("legal hold") is attached to. A hold on a space covers
 * everything inside it; a hold on the organization covers everything, which is
 * the blunt instrument for "freeze this tenant, we are in litigation".
 */
export const legalHoldSubject = wikiSchema.enum("legal_hold_subject", [
  "organization",
  "space",
  "page",
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

/**
 * Directed notifications — one event, one named recipient, in contrast to the
 * broadcast digest below. The value names the *reason* the row exists, because
 * that is what the inbox renders; the page or comment it points at is on the
 * row itself.
 */
export const notificationType = wikiSchema.enum("notification_type", [
  "mention_page", // named in a page body
  "mention_comment", // named in a comment
  "comment_reply", // someone replied to the recipient's comment
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
