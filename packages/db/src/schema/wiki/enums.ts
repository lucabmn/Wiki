import { wikiSchema } from "./_schema";

export const spaceVisibility = wikiSchema.enum("space_visibility", [
  "public", // every org member can access (with `defaultRole`)
  "private", // only explicit members (users/teams) in space_member
  "restricted", // only the creator + explicit members
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
  "page.created",
  "page.updated",
  "page.published",
  "page.moved",
  "page.archived",
  "page.restored",
  "page.deleted",
  "comment.created",
  "comment.resolved",
  "attachment.uploaded",
]);

export const wikiRole = wikiSchema.enum("wiki_role", ["viewer", "commenter", "editor", "admin"]);

export const permissionSubject = wikiSchema.enum("permission_subject", ["user", "team"]);
