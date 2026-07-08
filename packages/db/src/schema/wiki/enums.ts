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
]);

export const wikiRole = wikiSchema.enum("wiki_role", ["viewer", "commenter", "editor", "admin"]);

export const permissionSubject = wikiSchema.enum("permission_subject", ["user", "team"]);
