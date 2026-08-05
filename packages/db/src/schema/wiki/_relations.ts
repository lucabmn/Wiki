import { relations } from "drizzle-orm";

import { user, organization, team } from "../auth";
import { space, spaceMember } from "./spaces";
import { page, pageRevision, pageMember } from "./pages";
import { comment } from "./comments";
import { attachment } from "./attachments";
import { tag, pageTag } from "./tags";
import { pageExternalLink } from "./external-links";
import { pageLink } from "./links";
import { activity } from "./activity";
import { organizationSetting } from "./organization-settings";
import { favorite, pageSubscription } from "./user-state";
import { webhook, webhookDelivery } from "./webhooks";
import { notification } from "./inbox";

/**
 * Relations live in a single file so they can reference tables across modules
 * without creating import cycles between the table definitions themselves.
 */

export const spaceRelations = relations(space, ({ many }) => ({
  pages: many(page),
  members: many(spaceMember),
  tags: many(tag),
  attachments: many(attachment),
}));

export const spaceMemberRelations = relations(spaceMember, ({ one }) => ({
  space: one(space, { fields: [spaceMember.spaceId], references: [space.id] }),
  user: one(user, { fields: [spaceMember.userId], references: [user.id] }),
  team: one(team, { fields: [spaceMember.teamId], references: [team.id] }),
}));

export const pageRelations = relations(page, ({ one, many }) => ({
  space: one(space, { fields: [page.spaceId], references: [space.id] }),
  parent: one(page, {
    fields: [page.parentId],
    references: [page.id],
    relationName: "page_tree",
  }),
  children: many(page, { relationName: "page_tree" }),
  revisions: many(pageRevision),
  comments: many(comment),
  attachments: many(attachment),
  tags: many(pageTag),
  members: many(pageMember),
  outgoingLinks: many(pageLink, { relationName: "page_outgoing" }),
  backlinks: many(pageLink, { relationName: "page_incoming" }),
  externalLinks: many(pageExternalLink),
}));

export const pageExternalLinkRelations = relations(pageExternalLink, ({ one }) => ({
  page: one(page, { fields: [pageExternalLink.pageId], references: [page.id] }),
  creator: one(user, { fields: [pageExternalLink.createdBy], references: [user.id] }),
}));

export const pageMemberRelations = relations(pageMember, ({ one }) => ({
  page: one(page, { fields: [pageMember.pageId], references: [page.id] }),
  user: one(user, { fields: [pageMember.userId], references: [user.id] }),
  team: one(team, { fields: [pageMember.teamId], references: [team.id] }),
}));

export const pageRevisionRelations = relations(pageRevision, ({ one }) => ({
  page: one(page, { fields: [pageRevision.pageId], references: [page.id] }),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  page: one(page, { fields: [comment.pageId], references: [page.id] }),
  parent: one(comment, {
    fields: [comment.parentId],
    references: [comment.id],
    relationName: "comment_thread",
  }),
  replies: many(comment, { relationName: "comment_thread" }),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  space: one(space, { fields: [attachment.spaceId], references: [space.id] }),
  page: one(page, { fields: [attachment.pageId], references: [page.id] }),
}));

export const tagRelations = relations(tag, ({ one, many }) => ({
  space: one(space, { fields: [tag.spaceId], references: [space.id] }),
  pages: many(pageTag),
}));

export const pageTagRelations = relations(pageTag, ({ one }) => ({
  page: one(page, { fields: [pageTag.pageId], references: [page.id] }),
  tag: one(tag, { fields: [pageTag.tagId], references: [tag.id] }),
}));

export const pageLinkRelations = relations(pageLink, ({ one }) => ({
  source: one(page, {
    fields: [pageLink.sourcePageId],
    references: [page.id],
    relationName: "page_outgoing",
  }),
  target: one(page, {
    fields: [pageLink.targetPageId],
    references: [page.id],
    relationName: "page_incoming",
  }),
}));

export const activityRelations = relations(activity, ({ one }) => ({
  organization: one(organization, {
    fields: [activity.organizationId],
    references: [organization.id],
  }),
  space: one(space, { fields: [activity.spaceId], references: [space.id] }),
  page: one(page, { fields: [activity.pageId], references: [page.id] }),
  actor: one(user, { fields: [activity.actorId], references: [user.id] }),
}));

export const organizationSettingRelations = relations(organizationSetting, ({ one }) => ({
  organization: one(organization, {
    fields: [organizationSetting.organizationId],
    references: [organization.id],
  }),
}));

export const favoriteRelations = relations(favorite, ({ one }) => ({
  user: one(user, { fields: [favorite.userId], references: [user.id] }),
  page: one(page, { fields: [favorite.pageId], references: [page.id] }),
}));

export const pageSubscriptionRelations = relations(pageSubscription, ({ one }) => ({
  user: one(user, { fields: [pageSubscription.userId], references: [user.id] }),
  page: one(page, { fields: [pageSubscription.pageId], references: [page.id] }),
}));

export const webhookRelations = relations(webhook, ({ one, many }) => ({
  organization: one(organization, {
    fields: [webhook.organizationId],
    references: [organization.id],
  }),
  space: one(space, { fields: [webhook.spaceId], references: [space.id] }),
  deliveries: many(webhookDelivery),
}));

export const webhookDeliveryRelations = relations(webhookDelivery, ({ one }) => ({
  webhook: one(webhook, { fields: [webhookDelivery.webhookId], references: [webhook.id] }),
  activity: one(activity, { fields: [webhookDelivery.activityId], references: [activity.id] }),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
  recipient: one(user, { fields: [notification.userId], references: [user.id] }),
  actor: one(user, { fields: [notification.actorId], references: [user.id] }),
  page: one(page, { fields: [notification.pageId], references: [page.id] }),
  comment: one(comment, { fields: [notification.commentId], references: [comment.id] }),
}));
