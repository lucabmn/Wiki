import { z } from "zod";

import { IdSchema } from "./shared";

export const NotificationTypeSchema = z.enum(["mention_page", "mention_comment", "comment_reply"]);

/**
 * One inbox row, already joined to what the list renders. The page title lives
 * on the row rather than being fetched by the client, because the server has to
 * re-check read access to serve it anyway — see `inboxRouter.list`.
 */
export const InboxItemSchema = z.object({
  id: IdSchema,
  type: NotificationTypeSchema,
  createdAt: z.date(),
  readAt: z.date().nullable(),
  actor: z.object({ id: IdSchema, name: z.string() }).nullable(),
  page: z.object({ id: IdSchema, title: z.string(), icon: z.string().nullable() }),
  commentId: IdSchema.nullable(),
  /** Short quote of the comment, so the list is readable without opening it. */
  excerpt: z.string().nullable(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const ListInboxInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  onlyUnread: z.boolean().default(false),
});

export const DirectNotificationPreferencesSchema = z.object({
  /** Someone names you on a page or in a comment. */
  mentions: z.boolean(),
  /** Someone replies to a comment you wrote. */
  commentReplies: z.boolean(),
});

export const OrganizationDirectSettingsSchema = DirectNotificationPreferencesSchema.extend({
  allowUserOverride: z.boolean(),
});

/** Every field optional: the admin form may flip one switch. */
export const UpdateOrganizationDirectInputSchema = OrganizationDirectSettingsSchema.partial();

/** A user's stored override — `null` on a field means "inherit that one". */
export const UserDirectOverrideSchema = z.object({
  mentions: z.boolean().nullable(),
  commentReplies: z.boolean().nullable(),
});

export const UpdateMyDirectInputSchema = z.object({
  mentions: z.boolean().nullish(),
  commentReplies: z.boolean().nullish(),
});

export const MyDirectSettingsSchema = z.object({
  organization: OrganizationDirectSettingsSchema,
  override: UserDirectOverrideSchema.nullable(),
  effective: DirectNotificationPreferencesSchema,
  /** False when the admin has locked the organization defaults. */
  canOverride: z.boolean(),
});
