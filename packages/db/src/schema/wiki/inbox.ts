import { sql } from "drizzle-orm";
import { boolean, index, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { wikiSchema } from "./_schema";
import { id, timestamps } from "../_helpers";
import { comment } from "./comments";
import { notificationType } from "./enums";
import { page } from "./pages";
import { organization, user } from "../auth";

/**
 * Directed notifications: "you were named here", as opposed to the digest's
 * "here is what happened in your organization". They are delivered in-app
 * rather than by mail, because SMTP is optional on a self-hosted instance and a
 * feature that silently does nothing without it is worse than no feature.
 *
 * Two tables, and the second is the interesting one:
 *
 *   notification  — the inbox itself. Append-only apart from `read_at`.
 *   mention_notice — which people a page body or a comment *currently* names.
 *
 * `mention_notice` exists so delivery can diff instead of re-announcing. A
 * collaborative page is saved constantly; "notify everyone the document
 * mentions" would mail the same people on every save. Notifying the difference
 * against the last save needs a comparison basis that is independent of the
 * revision strategy (a save does not always snapshot a revision), so the set is
 * stored explicitly, per source. Removing a mention deletes its row, which is
 * what makes re-adding it later notify again — the correct behaviour, since
 * that is a genuinely new mention.
 */

export const notification = wikiSchema.table(
  "notification",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The recipient. Everything else on the row is context for them. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    /** Who caused it. Nulled rather than deleted when that account goes. */
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    /** Set for comment mentions and replies; null for a page-body mention. */
    commentId: text("comment_id").references(() => comment.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // The inbox query: one recipient's rows, newest first.
    index("notification_recipient_idx").on(t.userId, t.createdAt),
    // The badge query, which runs on every page view — kept partial so the
    // index stays small no matter how much read history piles up.
    index("notification_unread_idx")
      .on(t.userId)
      .where(sql`read_at is null`),
    index("notification_page_idx").on(t.pageId),
  ],
);

/**
 * One row per (source, mentioned user) currently in force. The source is a page
 * body (`commentId` null) or a single comment.
 *
 * Deliberately *not* a delivery log: a row is written for everyone the source
 * names, including recipients whose notification was suppressed (no read access,
 * or the setting switched off). It records the state of the document, so a save
 * that changes nothing about the mentions can never produce a second
 * notification for anyone.
 */
export const mentionNotice = wikiSchema.table(
  "mention_notice",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comment.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    // Two partial indexes rather than one over all three columns: in Postgres
    // NULLs are distinct, so a plain unique index would not constrain page-body
    // mentions (where `comment_id` is null) at all.
    uniqueIndex("mention_notice_page_uq")
      .on(t.pageId, t.userId)
      .where(sql`comment_id is null`),
    uniqueIndex("mention_notice_comment_uq")
      .on(t.commentId, t.userId)
      .where(sql`comment_id is not null`),
    index("mention_notice_page_idx").on(t.pageId),
  ],
);

// ── Settings ────────────────────────────────────────────────────────────────
//
// Same two-layer shape as the digest settings next door, and the same
// invariant: a user row exists only once they have customised something, and a
// null column means "inherit this one". Do not create rows eagerly — the
// absence of a row *is* the subscription to the organization's defaults.

export const organizationDirectNotificationSetting = wikiSchema.table(
  "organization_direct_notification_setting",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Not null: the org row is the fallback of last resort. On by default —
    // being named is exactly the case where silence is the wrong default.
    mentions: boolean("mentions").notNull().default(true),
    commentReplies: boolean("comment_replies").notNull().default(true),
    /** When false, user rows are ignored (but kept, so re-enabling restores). */
    allowUserOverride: boolean("allow_user_override").notNull().default(true),
    ...timestamps,
  },
);

export const userDirectNotificationSetting = wikiSchema.table(
  "user_direct_notification_setting",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    mentions: boolean("mentions"),
    commentReplies: boolean("comment_replies"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.organizationId] }),
    index("user_direct_notification_setting_org_idx").on(t.organizationId),
  ],
);
