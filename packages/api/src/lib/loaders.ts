import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { attachment, comment, page, space, tag } from "@nilovon-wiki/db/schema/index";

type Row<T> = NonNullable<Awaited<T>>;

/** Loads a space or throws NOT_FOUND. */
export async function loadSpace(db: Database, id: string) {
  const row = await db.query.space.findFirst({ where: eq(space.id, id) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Space not found" });
  }
  return row;
}

/** Loads a page or throws NOT_FOUND. */
export async function loadPage(db: Database, id: string) {
  const row = await db.query.page.findFirst({ where: eq(page.id, id) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  }
  return row;
}

/** Loads a comment or throws NOT_FOUND. */
export async function loadComment(db: Database, id: string) {
  const row = await db.query.comment.findFirst({ where: eq(comment.id, id) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Comment not found" });
  }
  return row;
}

/** Loads a tag or throws NOT_FOUND. */
export async function loadTag(db: Database, id: string) {
  const row = await db.query.tag.findFirst({ where: eq(tag.id, id) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Tag not found" });
  }
  return row;
}

/** Loads an attachment or throws NOT_FOUND. */
export async function loadAttachment(db: Database, id: string) {
  const row = await db.query.attachment.findFirst({ where: eq(attachment.id, id) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Attachment not found" });
  }
  return row;
}

/**
 * Resolves the organization that owns a space. Every wiki resource ultimately
 * hangs off a space, so this is the anchor for cross-org permission checks.
 */
export async function orgOfSpace(db: Database, spaceId: string): Promise<string> {
  const row = await db.query.space.findFirst({
    where: eq(space.id, spaceId),
    columns: { organizationId: true },
  });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Space not found" });
  }
  return row.organizationId;
}

export type PageRow = Row<ReturnType<typeof loadPage>>;
export type SpaceRow = Row<ReturnType<typeof loadSpace>>;
export type CommentRow = Row<ReturnType<typeof loadComment>>;
