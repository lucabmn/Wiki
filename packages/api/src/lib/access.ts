import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { pageMember, space, spaceMember } from "@nilovon-wiki/db/schema/index";
import { member, organizationRole, teamMember } from "@nilovon-wiki/db/schema/auth";

import type { AuthedContext } from "../context";

export type SpaceVisibility = "public" | "private" | "restricted";

/**
 * Who access is being resolved *for*. Every rule below needs exactly these two
 * facts, which is why they are named rather than taken from a session: the
 * digest runner evaluates the same rules for a user who has no request, no
 * headers and no active organization. `AuthedContext`-shaped callers keep their
 * signatures; those functions now just project the context onto a principal.
 */
export type Principal = {
  userId: string;
  /** The org the rules are evaluated in — a session's *active* org for requests. */
  organizationId: string | null;
};

function principalOf(context: AuthedContext): Principal {
  return {
    userId: context.session.user.id,
    organizationId: context.session.session.activeOrganizationId ?? null,
  };
}

export type SpaceAccessInput = {
  id: string;
  organizationId: string;
  visibility: SpaceVisibility;
  createdBy: string | null;
};

/**
 * The core read-access decision, kept pure so its truth table is unit-testable
 * without a database. Org membership is assumed already established (the caller
 * checks the space's org matches the caller's active org).
 *
 *   public     — any org member
 *   private    — explicit space members only (user row or via a team)
 *   restricted — the creator, plus explicit space members
 */
export function resolveSpaceAccess(
  visibility: SpaceVisibility,
  isMember: boolean,
  isCreator: boolean,
): boolean {
  switch (visibility) {
    case "public":
      return true;
    case "private":
      return isMember;
    case "restricted":
      return isCreator || isMember;
  }
}

/**
 * The org role (group) names the user holds in `organizationId` — their member
 * row's comma-separated role list. Used to resolve `subject="role"` grants that
 * grant a space/page to everyone in a group.
 */
async function orgRoleNames(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<string[]> {
  const row = await db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    columns: { role: true },
  });
  return (row?.role ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Team ids the user belongs to (across orgs; scoped by the space row later). */
async function userTeamIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.userId, userId));
  return rows.map((r) => r.teamId);
}

async function isSpaceMember(
  db: Database,
  spaceId: string,
  userId: string,
  teamIds: string[],
  roleNames: string[],
): Promise<boolean> {
  const row = await db.query.spaceMember.findFirst({
    where: and(
      eq(spaceMember.spaceId, spaceId),
      or(
        eq(spaceMember.userId, userId),
        teamIds.length ? inArray(spaceMember.teamId, teamIds) : undefined,
        roleNames.length ? inArray(spaceMember.roleName, roleNames) : undefined,
      ),
    ),
    columns: { id: true },
  });
  return !!row;
}

/** Whether `principal` may read this space (and thus its pages/comments/etc). */
export async function canReadSpaceAs(
  db: Database,
  principal: Principal,
  target: SpaceAccessInput,
): Promise<boolean> {
  // Cross-org reads are denied outright — rights in one org never reach
  // another org's spaces.
  if (target.organizationId !== principal.organizationId) {
    return false;
  }
  const { userId } = principal;
  if (target.visibility === "public") {
    return true;
  }
  const teamIds = await userTeamIds(db, userId);
  const roleNames = await orgRoleNames(db, userId, target.organizationId);
  const isMember = await isSpaceMember(db, target.id, userId, teamIds, roleNames);
  return resolveSpaceAccess(target.visibility, isMember, target.createdBy === userId);
}

/** Whether the caller may read this space (and thus its pages/comments/etc). */
export async function canReadSpace(
  db: Database,
  context: AuthedContext,
  target: SpaceAccessInput,
): Promise<boolean> {
  return canReadSpaceAs(db, principalOf(context), target);
}

/** Throwing variant used at the top of space-scoped read handlers. */
export async function assertSpaceRead(
  db: Database,
  context: AuthedContext,
  target: SpaceAccessInput,
): Promise<void> {
  if (!(await canReadSpace(db, context, target))) {
    throw new ORPCError("FORBIDDEN");
  }
}

// ---------------------------------------------------------------------------
// Write authorization — per-space roles
// ---------------------------------------------------------------------------
//
// Read (above) answers "can the caller SEE this space". This layer answers
// "what may they DO in it", from their `spaceMember.role`. Read remains purely
// membership/visibility based (org perms never grant read — private stays
// private); write folds in an org-manager override, but only on spaces the
// caller can already read, so the private-space contract holds.

export type WikiRole = "viewer" | "commenter" | "editor" | "admin";

const ROLE_RANK: Record<WikiRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  admin: 4,
};

export type SpaceCapability = "read" | "comment" | "write" | "manage";

const CAPABILITY_RANK: Record<SpaceCapability, number> = {
  read: ROLE_RANK.viewer,
  comment: ROLE_RANK.commenter,
  write: ROLE_RANK.editor,
  manage: ROLE_RANK.admin,
};

/** True if `role` (or none) is sufficient for `capability`. */
export function roleAllows(role: WikiRole | null, capability: SpaceCapability): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= CAPABILITY_RANK[capability];
}

/** The stronger of two roles (null = no role). */
function maxRole(a: WikiRole | null, b: WikiRole | null): WikiRole | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * The caller's effective role in a space, or `null` when they have no access.
 * Pure, so the truth table is unit-testable.
 *
 *   - Gated by the same read rule as `resolveSpaceAccess` first: no read ⇒ null.
 *   - Creator and org managers (owner/admin) act as `admin` — but only on a
 *     space they can already read, so org managers never reach a private space
 *     they aren't a member of.
 *   - Otherwise the membership role, or a `viewer` baseline on public spaces.
 */
export function resolveSpaceRole(
  visibility: SpaceVisibility,
  memberRole: WikiRole | null,
  isCreator: boolean,
  isOrgManager: boolean,
): WikiRole | null {
  if (!resolveSpaceAccess(visibility, memberRole !== null, isCreator)) {
    return null;
  }
  if (isCreator || isOrgManager) return "admin";
  // Public spaces grant a read-only baseline to non-members; write still needs
  // an explicit editor+ row.
  return maxRole(memberRole, visibility === "public" ? "viewer" : null);
}

/** Highest space-member role the user holds — directly, via a team, or a group. */
async function memberRoleInSpace(
  db: Database,
  spaceId: string,
  userId: string,
  teamIds: string[],
  roleNames: string[],
): Promise<WikiRole | null> {
  const rows = await db.query.spaceMember.findMany({
    where: and(
      eq(spaceMember.spaceId, spaceId),
      or(
        eq(spaceMember.userId, userId),
        teamIds.length ? inArray(spaceMember.teamId, teamIds) : undefined,
        roleNames.length ? inArray(spaceMember.roleName, roleNames) : undefined,
      ),
    ),
    columns: { role: true },
  });
  return rows.reduce<WikiRole | null>((acc, row) => maxRole(acc, row.role as WikiRole), null);
}

/** Loads the caller's effective role in a space (see `resolveSpaceRole`). */
export async function loadSpaceRole(
  db: Database,
  context: AuthedContext,
  target: SpaceAccessInput,
  isOrgManager: boolean,
): Promise<WikiRole | null> {
  return loadSpaceRoleAs(db, principalOf(context), target, isOrgManager);
}

/** Throws FORBIDDEN unless the caller has `capability` in the space. */
export async function assertSpaceCapability(
  db: Database,
  context: AuthedContext,
  target: SpaceAccessInput,
  capability: SpaceCapability,
  isOrgManager: boolean,
): Promise<void> {
  const role = await loadSpaceRole(db, context, target, isOrgManager);
  if (!roleAllows(role, capability)) {
    throw new ORPCError("FORBIDDEN");
  }
}

/**
 * Owner-aware capability gate for user-authored resources (comments,
 * attachments): the author may always act on their own; anyone else needs
 * `capability` in the space.
 */
export async function assertOwnerOrSpaceCapability(
  db: Database,
  context: AuthedContext,
  target: SpaceAccessInput,
  opts: { isOwner: boolean; capability: SpaceCapability; isOrgManager: boolean },
): Promise<void> {
  if (opts.isOwner) {
    // Still require the author to be able to read the space (e.g. removed
    // members can't act on old content).
    await assertSpaceRead(db, context, target);
    return;
  }
  await assertSpaceCapability(db, context, target, opts.capability, opts.isOrgManager);
}

// ---------------------------------------------------------------------------
// Page-level access control (optional, restricts within a space)
// ---------------------------------------------------------------------------
//
// A page may carry its own `visibility` override. When set, access is resolved
// against the page's own members — but it can only *narrow* space access, never
// widen it (effective role = min(spaceRole, pageRole)), and a space admin is
// never locked out. `visibility === null` means "inherit the space".

export type PageAccessInput = {
  id: string;
  visibility: SpaceVisibility | null;
  createdBy: string | null;
};

function minRole(a: WikiRole | null, b: WikiRole | null): WikiRole | null {
  if (!a || !b) return null;
  return ROLE_RANK[a] <= ROLE_RANK[b] ? a : b;
}

/**
 * The caller's effective role on a page, or `null` for no access. Pure.
 * `spaceRole` is their already-resolved role in the owning space.
 */
export function resolvePageRole(
  spaceRole: WikiRole | null,
  pageVisibility: SpaceVisibility | null,
  pageMemberRole: WikiRole | null,
  isPageCreator: boolean,
  isOrgManager: boolean,
): WikiRole | null {
  if (spaceRole === null) return null; // no space access ⇒ no page access
  if (spaceRole === "admin") return "admin"; // space admins bypass page ACLs
  if (pageVisibility === null) return spaceRole; // inherit the space
  // Page override: resolve against the page's own membership, then cap at the
  // space role (a page grant can't exceed what the space allows).
  if (!resolveSpaceAccess(pageVisibility, pageMemberRole !== null, isPageCreator)) {
    return null;
  }
  const override =
    isPageCreator || isOrgManager
      ? "admin"
      : maxRole(pageMemberRole, pageVisibility === "public" ? "viewer" : null);
  return minRole(spaceRole, override);
}

/** Highest page-member role the user holds — directly, via a team, or a group. */
async function memberRoleOnPage(
  db: Database,
  pageId: string,
  userId: string,
  teamIds: string[],
  roleNames: string[],
): Promise<WikiRole | null> {
  const rows = await db.query.pageMember.findMany({
    where: and(
      eq(pageMember.pageId, pageId),
      or(
        eq(pageMember.userId, userId),
        teamIds.length ? inArray(pageMember.teamId, teamIds) : undefined,
        roleNames.length ? inArray(pageMember.roleName, roleNames) : undefined,
      ),
    ),
    columns: { role: true },
  });
  return rows.reduce<WikiRole | null>((acc, row) => maxRole(acc, row.role as WikiRole), null);
}

/**
 * Loads the caller's effective role on a page. `spaceRole` is passed in (compute
 * it once via `loadSpaceRole`) to avoid re-querying space membership per page.
 */
export async function loadPageRole(
  db: Database,
  context: AuthedContext,
  pageRow: PageAccessInput,
  spaceRole: WikiRole | null,
  isOrgManager: boolean,
): Promise<WikiRole | null> {
  // Fast paths that never need the page's own membership.
  if (spaceRole === null || spaceRole === "admin" || pageRow.visibility === null) {
    return resolvePageRole(spaceRole, pageRow.visibility, null, false, isOrgManager);
  }
  const userId = context.session.user.id;
  const activeOrg = context.session.session.activeOrganizationId;
  const teamIds = await userTeamIds(db, userId);
  const roleNames = activeOrg ? await orgRoleNames(db, userId, activeOrg) : [];
  const memberRole = await memberRoleOnPage(db, pageRow.id, userId, teamIds, roleNames);
  return resolvePageRole(
    spaceRole,
    pageRow.visibility,
    memberRole,
    pageRow.createdBy === userId,
    isOrgManager,
  );
}

/**
 * Filters a batch of pages (all in the same space) to those the caller may read,
 * respecting per-page overrides. `spaceRole` is the caller's role in that space.
 * One extra query only when some page carries an override.
 */
export async function filterReadablePagesAs<T extends PageAccessInput>(
  db: Database,
  principal: Principal,
  pages: T[],
  spaceRole: WikiRole | null,
): Promise<T[]> {
  if (spaceRole === null) return [];
  if (spaceRole === "admin") return pages; // admins see everything in the space
  const overridden = pages.filter((p) => p.visibility !== null);
  if (overridden.length === 0) return pages; // no page ACLs → all inherit space
  const { userId, organizationId: activeOrg } = principal;
  const teamIds = await userTeamIds(db, userId);
  const roleNames = activeOrg ? await orgRoleNames(db, userId, activeOrg) : [];
  const rows = await db.query.pageMember.findMany({
    where: and(
      inArray(
        pageMember.pageId,
        overridden.map((p) => p.id),
      ),
      or(
        eq(pageMember.userId, userId),
        teamIds.length ? inArray(pageMember.teamId, teamIds) : undefined,
        roleNames.length ? inArray(pageMember.roleName, roleNames) : undefined,
      ),
    ),
    columns: { pageId: true, role: true },
  });
  const roleByPage = new Map<string, WikiRole>();
  for (const row of rows) {
    roleByPage.set(row.pageId, maxRole(roleByPage.get(row.pageId) ?? null, row.role as WikiRole)!);
  }
  return pages.filter((p) => {
    if (p.visibility === null) return true;
    const role = resolvePageRole(
      spaceRole,
      p.visibility,
      roleByPage.get(p.id) ?? null,
      p.createdBy === userId,
      false,
    );
    return role !== null;
  });
}

/** Session-bound wrapper around `filterReadablePagesAs`. */
export async function filterReadablePages<T extends PageAccessInput>(
  db: Database,
  context: AuthedContext,
  pages: T[],
  spaceRole: WikiRole | null,
): Promise<T[]> {
  return filterReadablePagesAs(db, principalOf(context), pages, spaceRole);
}

/**
 * Space ids the principal holds an *explicit* grant on — directly, via a team,
 * or via an org group. This is membership, not readability: a public space the
 * principal was never added to is absent. Exposed because "my spaces" is a
 * meaningful scope on its own (digest filters), separate from "spaces I may
 * read".
 */
export async function loadSpaceMembershipIds(
  db: Database,
  principal: Principal,
): Promise<Set<string>> {
  const { userId, organizationId } = principal;
  const teamIds = await userTeamIds(db, userId);
  const roleNames = organizationId ? await orgRoleNames(db, userId, organizationId) : [];
  const rows = await db
    .select({ spaceId: spaceMember.spaceId })
    .from(spaceMember)
    .where(
      or(
        eq(spaceMember.userId, userId),
        teamIds.length ? inArray(spaceMember.teamId, teamIds) : undefined,
        roleNames.length ? inArray(spaceMember.roleName, roleNames) : undefined,
      ),
    );
  return new Set(rows.map((row) => row.spaceId));
}

/**
 * Builds a synchronous read predicate after loading the principal's memberships
 * once — use it to filter a batch of already-fetched spaces without a query per
 * row. Only spaces in the principal's organization can pass.
 */
export async function buildSpaceReadFilterAs(
  db: Database,
  principal: Principal,
): Promise<(target: SpaceAccessInput) => boolean> {
  const { userId, organizationId: activeOrg } = principal;
  const memberSet = await loadSpaceMembershipIds(db, principal);
  return (target) =>
    target.organizationId === activeOrg &&
    resolveSpaceAccess(target.visibility, memberSet.has(target.id), target.createdBy === userId);
}

/** Session-bound wrapper around `buildSpaceReadFilterAs`. */
export async function buildSpaceReadFilter(
  db: Database,
  context: AuthedContext,
): Promise<(target: SpaceAccessInput) => boolean> {
  return buildSpaceReadFilterAs(db, principalOf(context));
}

/**
 * The set of space ids in `organizationId` the principal may read. Used to
 * filter cross-space reads (search, activity feed, favorites, digests) to
 * accessible spaces.
 */
export async function readableSpaceIdsAs(
  db: Database,
  principal: Principal,
  organizationId: string,
): Promise<string[]> {
  const spaces = await loadReadableSpacesAs(db, principal, organizationId);
  return spaces.map((s) => s.id);
}

/**
 * Like `readableSpaceIdsAs`, but keeps the rows. Callers that afterwards need
 * to resolve *page*-level access want the space's visibility and creator, and
 * re-fetching them per space would be a query per row.
 */
export async function loadReadableSpacesAs(
  db: Database,
  principal: Principal,
  organizationId: string,
): Promise<SpaceAccessInput[]> {
  const [spaces, canRead] = await Promise.all([
    db
      .select({
        id: space.id,
        organizationId: space.organizationId,
        visibility: space.visibility,
        createdBy: space.createdBy,
      })
      .from(space)
      // Trashed spaces are excluded here rather than at each call site, so every
      // cross-space reader built on this helper — search, the activity feed, the
      // dashboard counters, the digest collector — inherits the rule for free.
      .where(
        and(
          eq(space.organizationId, organizationId),
          isNull(space.archivedAt),
          isNull(space.deletedAt),
        ),
      ),
    buildSpaceReadFilterAs(db, principal),
  ]);
  return spaces.filter(canRead);
}

/** Session-bound wrapper around `readableSpaceIdsAs`. */
export async function readableSpaceIds(
  db: Database,
  context: AuthedContext,
  organizationId: string,
): Promise<string[]> {
  return readableSpaceIdsAs(db, principalOf(context), organizationId);
}

/**
 * Session-free counterpart to `isOrgManager` (which needs the caller's headers
 * to ask better-auth). Resolves the same question — does this user hold
 * `member:["update"]` in the org — from the stored role assignment alone, so a
 * background job can answer it.
 *
 * Static `owner`/`admin` carry the grant by definition. A dynamic role (group)
 * carries it when its stored permission document lists it; better-auth keeps
 * that document as JSON in `organization_role.permission`.
 */
export async function isOrgManagerAs(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const roleNames = await orgRoleNames(db, userId, organizationId);
  if (roleNames.some((name) => name === "owner" || name === "admin")) return true;
  const dynamic = roleNames.filter((name) => name !== "member");
  if (dynamic.length === 0) return false;
  const rows = await db
    .select({ permission: organizationRole.permission })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        inArray(organizationRole.role, dynamic),
      ),
    );
  return rows.some((row) => {
    try {
      const parsed: unknown = JSON.parse(row.permission);
      const actions = (parsed as Record<string, unknown> | null)?.member;
      return Array.isArray(actions) && actions.includes("update");
    } catch {
      // A malformed document must not hand out rights.
      return false;
    }
  });
}

/**
 * The principal's effective role in a space, resolved without a session. Mirrors
 * `loadSpaceRole`; the org-manager override is resolved via `isOrgManagerAs`.
 */
export async function loadSpaceRoleAs(
  db: Database,
  principal: Principal,
  target: SpaceAccessInput,
  isOrgManager: boolean,
): Promise<WikiRole | null> {
  if (target.organizationId !== principal.organizationId) {
    return null;
  }
  const { userId } = principal;
  const teamIds = await userTeamIds(db, userId);
  const roleNames = await orgRoleNames(db, userId, target.organizationId);
  const memberRole = await memberRoleInSpace(db, target.id, userId, teamIds, roleNames);
  return resolveSpaceRole(target.visibility, memberRole, target.createdBy === userId, isOrgManager);
}
