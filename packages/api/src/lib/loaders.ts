import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  attachment,
  comment,
  page,
  pageExternalLink,
  space,
  tag,
} from "@nilovon-wiki/db/schema/index";

type Row<T> = NonNullable<Awaited<T>>;

/**
 * Trashed rows are invisible by default, everywhere.
 *
 * A soft delete only works if it fails closed: every reader that forgets about
 * `deletedAt` would otherwise keep serving a page the user believes is gone.
 * Making the two central loaders hide trashed rows means a new endpoint is
 * correct without its author having to know about the trash, and the handful of
 * places that legitimately need a trashed row (the trash view, restore, purge)
 * say so explicitly.
 */
export type LoadOptions = { includeTrashed?: boolean };

/** Loads a space or throws NOT_FOUND. Trashed spaces are hidden by default. */
export async function loadSpace(db: Database, id: string, options: LoadOptions = {}) {
  const row = await db.query.space.findFirst({ where: eq(space.id, id) });
  if (!row || (row.deletedAt && !options.includeTrashed)) {
    throw new ORPCError("NOT_FOUND", { message: "Space not found" });
  }
  return row;
}

/**
 * Loads a page or throws NOT_FOUND. Hidden by default when the page itself is
 * trashed *or* its space is: trashing a space does not stamp its pages (restore
 * has to be able to tell which pages were individually deleted first), so the
 * space's state has to be consulted here.
 */
export async function loadPage(db: Database, id: string, options: LoadOptions = {}) {
  const rows = await db
    .select({ page, spaceDeletedAt: space.deletedAt })
    .from(page)
    .innerJoin(space, eq(page.spaceId, space.id))
    .where(eq(page.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || (!options.includeTrashed && (row.page.deletedAt || row.spaceDeletedAt))) {
    throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  }
  return row.page;
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

/** Loads a page's external link or throws NOT_FOUND. */
export async function loadExternalLink(db: Database, id: string) {
  const row = await db.query.pageExternalLink.findFirst({
    where: eq(pageExternalLink.id, id),
  });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "External link not found" });
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
