import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { page, pageLink } from "@nilovon-wiki/db/schema/index";

// syncPageLinks needs read + write; both the db handle and a transaction satisfy
// this, so link maintenance runs inside the page mutation's tx.
type LinkExecutor = Pick<Database, "select" | "insert" | "delete">;

/**
 * De-duplicates a set of link target ids and drops any self-reference. Pure, so
 * the reconcile contract is unit-testable independent of the (undefined) editor
 * content format.
 */
export function normalizeLinkTargets(sourcePageId: string, targetIds: string[]): string[] {
  return [...new Set(targetIds)].filter((id) => id !== sourcePageId);
}

/**
 * Extracts referenced page ids from a page's rich-text content.
 *
 * INTENTIONAL STUB: the editor and its internal-link representation don't exist
 * yet (the content column is opaque JSON, format undecided). Parsing an invented
 * shape now can't be verified — its tests would be circular — so this returns no
 * links until the editor lands. Implement the doc walk here then (collect the
 * nodes/marks that carry a target page id) and the write-path below activates
 * with no other change.
 */
export function extractPageLinks(_content: unknown): string[] {
  return [];
}

/**
 * Replaces a page's outgoing internal links to match `targetIds`. Targets are
 * filtered to pages that actually exist in the same space (the FK only checks
 * existence, and a dangling id would error). Idempotent: safe to call on every
 * content save.
 */
export async function syncPageLinks(
  db: LinkExecutor,
  sourcePageId: string,
  spaceId: string,
  targetIds: string[],
): Promise<void> {
  const wanted = normalizeLinkTargets(sourcePageId, targetIds);
  const valid = wanted.length
    ? (
        await db
          .select({ id: page.id })
          .from(page)
          .where(and(inArray(page.id, wanted), eq(page.spaceId, spaceId)))
      ).map((r) => r.id)
    : [];

  await db.delete(pageLink).where(eq(pageLink.sourcePageId, sourcePageId));
  if (valid.length) {
    await db
      .insert(pageLink)
      .values(valid.map((targetPageId) => ({ sourcePageId, targetPageId })))
      .onConflictDoNothing();
  }
}
