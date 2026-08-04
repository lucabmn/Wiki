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
  "comment.resolved",
  "comment.deleted",
  "attachment.uploaded",
  "attachment.deleted",
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
