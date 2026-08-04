import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { legalHold, page } from "@nilovon-wiki/db/schema/index";

/**
 * Deletion blocks ("legal holds"), resolved into something both the purge
 * runner and the request path can ask cheap questions of.
 *
 * A hold names one subject, but its effect is inherited: a hold on a space
 * protects that space's pages, their comments, their attachments and every audit
 * row pointing at them. Inheritance is resolved *here*, once, rather than
 * assumed at each call site — an assumed rule is a rule nobody tested.
 */
export type HoldScope = {
  /** A hold on the organization itself freezes everything in it. */
  organization: boolean;
  spaceIds: Set<string>;
  pageIds: Set<string>;
};

export const EMPTY_HOLD_SCOPE: HoldScope = {
  organization: false,
  spaceIds: new Set(),
  pageIds: new Set(),
};

/** Every unreleased hold in one organization. Released rows are history, not rules. */
export async function loadHoldScope(db: Database, organizationId: string): Promise<HoldScope> {
  const rows = await db
    .select({ subject: legalHold.subject, subjectId: legalHold.subjectId })
    .from(legalHold)
    .where(and(eq(legalHold.organizationId, organizationId), isNull(legalHold.releasedAt)));

  const scope: HoldScope = { organization: false, spaceIds: new Set(), pageIds: new Set() };
  for (const row of rows) {
    if (row.subject === "organization") scope.organization = true;
    else if (row.subject === "space") scope.spaceIds.add(row.subjectId);
    else scope.pageIds.add(row.subjectId);
  }
  return scope;
}

/** Is this page protected — by its own hold, its space's, or the org's? */
export function isPageHeld(scope: HoldScope, target: { id: string; spaceId: string }): boolean {
  return scope.organization || scope.spaceIds.has(target.spaceId) || scope.pageIds.has(target.id);
}

/** Is this space protected? Page-level holds inside it are checked separately. */
export function isSpaceHeld(scope: HoldScope, spaceId: string): boolean {
  return scope.organization || scope.spaceIds.has(spaceId);
}

/**
 * Is an audit row protected? Rows carry both ids, so a page in a held space is
 * covered by the space check without resolving the page's parentage.
 */
export function isActivityHeld(
  scope: HoldScope,
  row: { spaceId: string | null; pageId: string | null },
): boolean {
  if (scope.organization) return true;
  if (row.spaceId && scope.spaceIds.has(row.spaceId)) return true;
  return !!row.pageId && scope.pageIds.has(row.pageId);
}

/**
 * A hold that only stops background jobs is not a hold. Manual deletion has to
 * fail too, and with a message that says why — a "Delete" button that silently
 * does nothing is worse than one that refuses out loud.
 */
function refuse(subject: string): never {
  throw new ORPCError("CONFLICT", {
    message: `Für ${subject} besteht eine Löschsperre. Hebe die Sperre auf, um zu löschen.`,
  });
}

/**
 * Blocks deleting or purging a page. Descendants are included because trashing
 * a page takes its whole subtree with it: a held child must stop its parent from
 * being deleted, or the hold would be circumvented one level up.
 */
export async function assertPageDeletable(
  db: Database,
  target: { id: string; spaceId: string; organizationId: string },
): Promise<void> {
  const scope = await loadHoldScope(db, target.organizationId);
  if (scope.organization) refuse("diese Organisation");
  if (scope.spaceIds.has(target.spaceId)) refuse("den Bereich dieser Seite");
  if (scope.pageIds.has(target.id)) refuse("diese Seite");
  if (scope.pageIds.size === 0) return;
  const subtree = await pageSubtreeIds(db, target.id);
  if (subtree.some((id) => scope.pageIds.has(id))) refuse("eine Unterseite dieser Seite");
}

/**
 * Blocks deleting or purging a space. A hold on any page inside it counts: the
 * space delete would otherwise cascade the held page away.
 */
export async function assertSpaceDeletable(
  db: Database,
  target: { id: string; organizationId: string },
): Promise<void> {
  const scope = await loadHoldScope(db, target.organizationId);
  if (scope.organization) refuse("diese Organisation");
  if (scope.spaceIds.has(target.id)) refuse("diesen Bereich");
  if (await hasHeldPageInSpace(db, scope, target.id)) refuse("eine Seite in diesem Bereich");
}

/**
 * Blocks deleting something that hangs off a page — a comment, an attachment.
 * The object itself cannot carry a hold, so it inherits the page's.
 */
export async function assertPageContentDeletable(
  db: Database,
  target: { id: string; spaceId: string; organizationId: string },
): Promise<void> {
  const scope = await loadHoldScope(db, target.organizationId);
  if (isPageHeld(scope, target)) {
    refuse(scope.pageIds.has(target.id) ? "diese Seite" : "den Bereich dieser Seite");
  }
}

/** True when any held page currently lives in `spaceId`. */
export async function hasHeldPageInSpace(
  db: Database,
  scope: HoldScope,
  spaceId: string,
): Promise<boolean> {
  if (scope.pageIds.size === 0) return false;
  const row = await db.query.page.findFirst({
    where: and(eq(page.spaceId, spaceId), inArray(page.id, [...scope.pageIds])),
    columns: { id: true },
  });
  return !!row;
}

/**
 * Every page id below `rootId`, inclusive. Walked level by level rather than
 * with a recursive CTE so the same code runs on pglite in the test suite.
 */
export async function pageSubtreeIds(db: Database, rootId: string): Promise<string[]> {
  const collected = [rootId];
  let frontier = [rootId];
  // Bounded by the tree's depth; the visited set makes a corrupted cycle
  // terminate instead of spinning forever.
  while (frontier.length > 0) {
    const children = await db
      .select({ id: page.id })
      .from(page)
      .where(inArray(page.parentId, frontier));
    frontier = children.map((row) => row.id).filter((id) => !collected.includes(id));
    collected.push(...frontier);
  }
  return collected;
}
