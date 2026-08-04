// Sibling ordering and parent validation for the page tree. Extracted from the
// page router so every procedure that inserts or moves a page — including the
// template router — resolves positions and validates parents the same way.

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { page } from "@nilovon-wiki/db/schema/index";

import { generateKeyBetween } from "./fractional";
import { loadPage } from "./loaders";

/** Sibling scope predicate: same space, same parent (null-aware). */
export function siblingsOf(spaceId: string, parentId: string | null) {
  return and(
    eq(page.spaceId, spaceId),
    parentId === null ? isNull(page.parentId) : eq(page.parentId, parentId),
  );
}

/** Position at the end of a sibling list (after the last child). */
export async function positionAtEnd(
  db: Database,
  spaceId: string,
  parentId: string | null,
  excludeId?: string,
): Promise<string> {
  const last = await db.query.page.findFirst({
    where: excludeId
      ? and(siblingsOf(spaceId, parentId), sql`${page.id} <> ${excludeId}`)
      : siblingsOf(spaceId, parentId),
    orderBy: [desc(page.position)],
    columns: { position: true },
  });
  return generateKeyBetween(last?.position ?? null, null);
}

/**
 * Ensures a requested parent page exists in `spaceId`. Without this, a
 * client-supplied `parentId` could point into another space (or another org's
 * space), corrupting the tree and doubling as a page-existence oracle.
 */
export async function assertParentInSpace(
  db: Database,
  parentId: string | null,
  spaceId: string,
): Promise<void> {
  if (!parentId) return;
  const parent = await db.query.page.findFirst({
    where: eq(page.id, parentId),
    columns: { spaceId: true },
  });
  if (!parent || parent.spaceId !== spaceId) {
    throw new ORPCError("BAD_REQUEST", { message: "Parent page is not in this space" });
  }
}

/**
 * Walks the ancestor chain of `parentId` to ensure `movedId` is not among its
 * ancestors — otherwise the move would create a cycle in the page tree.
 */
export async function assertNoCycle(
  db: Database,
  movedId: string,
  parentId: string | null,
): Promise<void> {
  let cursor = parentId;
  while (cursor) {
    if (cursor === movedId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Cannot move a page underneath itself",
      });
    }
    const parent = await db.query.page.findFirst({
      where: eq(page.id, cursor),
      columns: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

/** Resolves a reorder request into a fractional position within the parent. */
export async function positionForMove(
  db: Database,
  spaceId: string,
  parentId: string | null,
  movedId: string,
  beforeId?: string,
  afterId?: string,
): Promise<string> {
  const not = sql`${page.id} <> ${movedId}`;
  if (afterId) {
    const anchor = await loadPage(db, afterId);
    const next = await db.query.page.findFirst({
      where: and(siblingsOf(spaceId, parentId), gt(page.position, anchor.position), not),
      orderBy: [asc(page.position)],
      columns: { position: true },
    });
    return generateKeyBetween(anchor.position, next?.position ?? null);
  }
  if (beforeId) {
    const anchor = await loadPage(db, beforeId);
    const prev = await db.query.page.findFirst({
      where: and(siblingsOf(spaceId, parentId), lt(page.position, anchor.position), not),
      orderBy: [desc(page.position)],
      columns: { position: true },
    });
    return generateKeyBetween(prev?.position ?? null, anchor.position);
  }
  return positionAtEnd(db, spaceId, parentId, movedId);
}
