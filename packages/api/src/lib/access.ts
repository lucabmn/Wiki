import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { space, spaceMember } from "@nilovon-wiki/db/schema/index";
import { teamMember } from "@nilovon-wiki/db/schema/auth";

import type { Context } from "../context";

export type SpaceVisibility = "public" | "private" | "restricted";

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
): Promise<boolean> {
  const row = await db.query.spaceMember.findFirst({
    where: and(
      eq(spaceMember.spaceId, spaceId),
      or(
        eq(spaceMember.userId, userId),
        teamIds.length ? inArray(spaceMember.teamId, teamIds) : undefined,
      ),
    ),
    columns: { id: true },
  });
  return !!row;
}

/** Whether the caller may read this space (and thus its pages/comments/etc). */
export async function canReadSpace(
  db: Database,
  context: Context,
  target: SpaceAccessInput,
): Promise<boolean> {
  // Cross-org reads are denied outright — active-org rights never reach another
  // org's spaces.
  if (target.organizationId !== context.session?.session.activeOrganizationId) {
    return false;
  }
  const userId = context.session.user.id;
  if (target.visibility === "public") {
    return true;
  }
  const teamIds = await userTeamIds(db, userId);
  const isMember = await isSpaceMember(db, target.id, userId, teamIds);
  return resolveSpaceAccess(target.visibility, isMember, target.createdBy === userId);
}

/** Throwing variant used at the top of space-scoped read handlers. */
export async function assertSpaceRead(
  db: Database,
  context: Context,
  target: SpaceAccessInput,
): Promise<void> {
  if (!(await canReadSpace(db, context, target))) {
    throw new ORPCError("FORBIDDEN");
  }
}

/**
 * Builds a synchronous read predicate after loading the caller's memberships
 * once — use it to filter a batch of already-fetched spaces without a query per
 * row. Only spaces in the caller's active org can pass.
 */
export async function buildSpaceReadFilter(
  db: Database,
  context: Context,
): Promise<(target: SpaceAccessInput) => boolean> {
  const userId = context.session!.user.id;
  const activeOrg = context.session?.session.activeOrganizationId;
  const teamIds = await userTeamIds(db, userId);
  const memberRows = await db
    .select({ spaceId: spaceMember.spaceId })
    .from(spaceMember)
    .where(
      or(
        eq(spaceMember.userId, userId),
        teamIds.length ? inArray(spaceMember.teamId, teamIds) : undefined,
      ),
    );
  const memberSet = new Set(memberRows.map((r) => r.spaceId));
  return (target) =>
    target.organizationId === activeOrg &&
    resolveSpaceAccess(target.visibility, memberSet.has(target.id), target.createdBy === userId);
}

/**
 * The set of space ids in `organizationId` the caller may read. Used to filter
 * cross-space reads (search, activity feed, favorites) to accessible spaces.
 */
export async function readableSpaceIds(
  db: Database,
  context: Context,
  organizationId: string,
): Promise<string[]> {
  const [spaces, canRead] = await Promise.all([
    db
      .select({
        id: space.id,
        organizationId: space.organizationId,
        visibility: space.visibility,
        createdBy: space.createdBy,
      })
      .from(space)
      .where(and(eq(space.organizationId, organizationId), isNull(space.archivedAt))),
    buildSpaceReadFilter(db, context),
  ]);
  return spaces.filter(canRead).map((s) => s.id);
}
