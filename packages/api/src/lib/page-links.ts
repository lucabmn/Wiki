import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { page, pageLink } from "@nilovon-wiki/db/schema/index";

import { pageIdFromHref } from "./page-href";

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

/** A single ProseMirror/TipTap node: may carry text marks and child content. */
type ProseMirrorNode = {
  marks?: Array<{ type?: string; attrs?: { href?: string | null } }>;
  content?: ProseMirrorNode[];
};

/**
 * Extracts referenced page ids from a page's rich-text content.
 *
 * The editor represents an internal link as a `link` mark whose href is
 * `/pages/<id>` (see {@link pageIdFromHref}); this walks the TipTap document
 * tree and collects the target id of every such mark. Duplicates and dangling
 * ids are handled downstream by {@link syncPageLinks}. Any non-document input
 * (null, a string, a malformed shape) yields no links rather than throwing.
 */
export function extractPageLinks(content: unknown): string[] {
  const ids: string[] = [];
  const visit = (node: ProseMirrorNode | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark?.type === "link") {
          const id = pageIdFromHref(mark.attrs?.href);
          if (id) ids.push(id);
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };
  visit(content as ProseMirrorNode);
  return ids;
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
