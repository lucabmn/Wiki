// Router-facing space authorization. Wraps the pure resolvers in `access.ts`
// with the org-manager override (an auth round-trip), computed once per call.
// Kept separate from `access.ts` so that module stays free of better-auth/env
// imports and its resolvers remain unit-testable in isolation.

import { ORPCError } from "@orpc/server";

import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import type { Database } from "@nilovon-wiki/db";

import type { AuthedContext } from "../context";
import { hasOrgPermission, isOrgManager } from "../index";
import {
  assertOwnerOrSpaceCapability,
  assertSpaceCapability,
  filterReadablePages,
  loadPageRole,
  loadSpaceRole,
  roleAllows,
  type PageAccessInput,
  type SpaceAccessInput,
  type SpaceCapability,
  type WikiRole,
} from "./access";
import { loadPage, loadSpace } from "./loaders";

/** Assert a capability against a space row; returns its org id for callers. */
export async function requireSpaceCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  space: SpaceAccessInput,
  capability: SpaceCapability,
): Promise<{ organizationId: string }> {
  const manager = await isOrgManager(headers, space.organizationId);
  await assertSpaceCapability(db, context, space, capability, manager);
  return { organizationId: space.organizationId };
}

/** Resolve a space by id, then assert a capability. Returns the loaded space. */
export async function requireSpaceCapabilityById(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  spaceId: string,
  capability: SpaceCapability,
) {
  const space = await loadSpace(db, spaceId);
  await requireSpaceCapability(db, context, headers, space, capability);
  return space;
}

/**
 * Space-management gate: allowed for a space admin (owner/admin, creator, or an
 * explicit `admin` member), or for anyone holding the org-level `orgPermission`
 * fallback (e.g. a custom group granted `space:["update"]` org-wide).
 */
export async function requireSpaceManage(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  space: SpaceAccessInput,
  orgPermission: PermissionRequest,
): Promise<void> {
  const manager = await isOrgManager(headers, space.organizationId);
  const role = await loadSpaceRole(db, context, space, manager);
  if (roleAllows(role, "manage")) return;
  if (await hasOrgPermission(headers, orgPermission, space.organizationId)) return;
  throw new ORPCError("FORBIDDEN");
}

type PageRowInput = PageAccessInput & { spaceId: string };

/**
 * Assert a capability on a page, respecting per-page overrides. Loads the page's
 * space, the caller's space role, then their effective page role.
 */
export async function requirePageCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  pageRow: PageRowInput,
  capability: SpaceCapability,
): Promise<{ organizationId: string }> {
  const spaceRow = await loadSpace(db, pageRow.spaceId);
  const manager = await isOrgManager(headers, spaceRow.organizationId);
  const spaceRole = await loadSpaceRole(db, context, spaceRow, manager);
  const pageRole = await loadPageRole(db, context, pageRow, spaceRole, manager);
  if (!roleAllows(pageRole, capability)) throw new ORPCError("FORBIDDEN");
  return { organizationId: spaceRow.organizationId };
}

/** Resolve a page by id, then assert a capability. Returns the loaded page. */
export async function requirePageCapabilityById(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  pageId: string,
  capability: SpaceCapability,
) {
  const page = await loadPage(db, pageId);
  await requirePageCapability(db, context, headers, page, capability);
  return page;
}

/**
 * Page-ACL management gate: a space admin (or org manager), or the page's own
 * author while they can still write in the space. Space admins are never locked
 * out; page editors who didn't author a page don't manage its sharing.
 */
export async function requirePageManage(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  pageRow: PageRowInput,
): Promise<{ organizationId: string }> {
  const spaceRow = await loadSpace(db, pageRow.spaceId);
  const manager = await isOrgManager(headers, spaceRow.organizationId);
  const spaceRole = await loadSpaceRole(db, context, spaceRow, manager);
  if (
    roleAllows(spaceRole, "manage") ||
    (pageRow.createdBy === context.session.user.id && roleAllows(spaceRole, "write"))
  ) {
    return { organizationId: spaceRow.organizationId };
  }
  throw new ORPCError("FORBIDDEN");
}

/** Non-throwing resolution of the caller's page access, for UI gating. */
export async function resolveMyPageAccess(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  pageRow: PageRowInput,
): Promise<{ role: WikiRole | null; canWrite: boolean; canManage: boolean }> {
  const spaceRow = await loadSpace(db, pageRow.spaceId);
  const manager = await isOrgManager(headers, spaceRow.organizationId);
  const spaceRole = await loadSpaceRole(db, context, spaceRow, manager);
  const role = await loadPageRole(db, context, pageRow, spaceRole, manager);
  const canManage =
    roleAllows(spaceRole, "manage") ||
    (pageRow.createdBy === context.session.user.id && roleAllows(spaceRole, "write"));
  return { role, canWrite: roleAllows(role, "write"), canManage };
}

/** Owner-aware page gate: the author may act if they can still read the page. */
export async function requireOwnerOrPageCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  pageRow: PageRowInput,
  opts: { isOwner: boolean; capability: SpaceCapability },
): Promise<{ organizationId: string }> {
  return requirePageCapability(
    db,
    context,
    headers,
    pageRow,
    opts.isOwner ? "read" : opts.capability,
  );
}

/**
 * Cross-space variant of `filterReadablePages`: filters pages that may span
 * several spaces (favorites, search hits, activity), respecting per-page
 * `visibility` overrides. Space-level read access must already be established
 * by the caller — pages without an override pass through unfiltered, so only
 * overridden pages cost extra queries, grouped per space.
 */
export async function filterReadablePagesAcrossSpaces<
  T extends PageAccessInput & { spaceId: string },
>(db: Database, context: AuthedContext, headers: Headers, pages: T[]): Promise<T[]> {
  const overridden = pages.filter((p) => p.visibility !== null);
  if (overridden.length === 0) return pages;
  const readable = new Set<string>();
  for (const spaceId of new Set(overridden.map((p) => p.spaceId))) {
    const spaceRow = await loadSpace(db, spaceId);
    const manager = await isOrgManager(headers, spaceRow.organizationId);
    const spaceRole = await loadSpaceRole(db, context, spaceRow, manager);
    const pass = await filterReadablePages(
      db,
      context,
      overridden.filter((p) => p.spaceId === spaceId),
      spaceRole,
    );
    for (const p of pass) readable.add(p.id);
  }
  return pages.filter((p) => p.visibility === null || readable.has(p.id));
}

/** Owner-aware capability gate for user-authored resources (comments, files). */
export async function requireOwnerOrSpaceCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  space: SpaceAccessInput,
  opts: { isOwner: boolean; capability: SpaceCapability },
): Promise<void> {
  const manager = await isOrgManager(headers, space.organizationId);
  await assertOwnerOrSpaceCapability(db, context, space, { ...opts, isOrgManager: manager });
}
