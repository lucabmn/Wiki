import { ORPCError } from "@orpc/server";
import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { spaceMember, team, user } from "@nilovon-wiki/db/schema/index";

import { isOrgManager, protectedProcedure } from "../index";
import { assertSpaceRead, loadSpaceRole } from "../lib/access";
import { requireSpaceManage } from "../lib/authz";
import { loadSpace } from "../lib/loaders";
import { assertPermissionSubjectInOrganization } from "../lib/permission-subject";
import { IdSchema } from "../schemas/shared";
import {
  AddSpaceMemberInputSchema,
  ListSpaceMembersInputSchema,
  RemoveSpaceMemberInputSchema,
  SpaceMemberSchema,
  UpdateSpaceMemberInputSchema,
  WikiRoleSchema,
} from "../schemas/space";

const TAGS = ["Space members"];

/** Reads a space-member row with its user/team display info, or throws. */
async function loadSpaceMember(db: Database, id: string) {
  const rows = await selectMembers(db, eq(spaceMember.id, id));
  const row = rows[0];
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Space member not found" });
  return row;
}

/** Joined select shared by list/load so both return the same shape. */
function selectMembers(db: Database, where: SQL) {
  return db
    .select({
      id: spaceMember.id,
      spaceId: spaceMember.spaceId,
      subject: spaceMember.subject,
      role: spaceMember.role,
      roleName: spaceMember.roleName,
      createdAt: spaceMember.createdAt,
      user: { id: user.id, name: user.name, email: user.email },
      team: { id: team.id, name: team.name },
    })
    .from(spaceMember)
    .leftJoin(user, eq(spaceMember.userId, user.id))
    .leftJoin(team, eq(spaceMember.teamId, team.id))
    .where(where);
}

/**
 * Number of admin members in a space — used to block orphaning management.
 * Locks the admin rows (`FOR UPDATE`), so it must run inside the transaction
 * that performs the demotion/removal: two concurrent calls would otherwise
 * both count 2 admins and each remove one, leaving the space with none.
 */
async function lockedAdminCount(tx: Pick<Database, "select">, spaceId: string): Promise<number> {
  const rows = await tx
    .select({ id: spaceMember.id })
    .from(spaceMember)
    .where(and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.role, "admin")))
    .for("update");
  return rows.length;
}

export const spaceMemberRouter = {
  // The caller's own effective role in a space (folds in the org-manager
  // override). Used by the UI to gate the "manage space" affordance.
  myRole: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces/{spaceId}/my-role",
      tags: TAGS,
      summary: "The caller's effective role in a space",
    })
    .input(z.object({ spaceId: IdSchema }))
    .output(z.object({ role: WikiRoleSchema.nullable() }))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const role = await loadSpaceRole(context.db, context, spaceRow, manager);
      return { role };
    }),

  list: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces/{spaceId}/members",
      tags: TAGS,
      summary: "List a space's members and their roles",
    })
    .input(ListSpaceMembersInputSchema)
    .output(z.array(SpaceMemberSchema))
    .handler(async ({ input, context }) => {
      const space = await loadSpace(context.db, input.spaceId);
      await assertSpaceRead(context.db, context, space);
      return selectMembers(context.db, eq(spaceMember.spaceId, input.spaceId));
    }),

  add: protectedProcedure
    .route({
      method: "POST",
      path: "/spaces/{spaceId}/members",
      tags: TAGS,
      summary: "Add a user or team to a space with a role",
    })
    .input(AddSpaceMemberInputSchema)
    .output(SpaceMemberSchema)
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.spaceId);
      await requireSpaceManage(context.db, context, context.headers, spaceRow, {
        space: ["update"],
      });
      await assertPermissionSubjectInOrganization(context.db, spaceRow.organizationId, input);
      const rows = await context.db
        .insert(spaceMember)
        .values({
          spaceId: input.spaceId,
          subject: input.subject,
          userId: input.subject === "user" ? input.userId : null,
          teamId: input.subject === "team" ? input.teamId : null,
          roleName: input.subject === "role" ? input.roleName : null,
          role: input.role,
        })
        .onConflictDoNothing()
        .returning();
      const inserted = rows[0];
      if (!inserted) {
        throw new ORPCError("CONFLICT", { message: "Already a member of this space" });
      }
      return loadSpaceMember(context.db, inserted.id);
    }),

  updateRole: protectedProcedure
    .route({
      method: "PATCH",
      path: "/space-members/{id}",
      tags: TAGS,
      summary: "Change a space member's role",
    })
    .input(UpdateSpaceMemberInputSchema)
    .output(SpaceMemberSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadSpaceMember(context.db, input.id);
      const spaceRow = await loadSpace(context.db, existing.spaceId);
      await requireSpaceManage(context.db, context, context.headers, spaceRow, {
        space: ["update"],
      });
      // Don't let the last admin demote themselves and orphan space management.
      await context.db.transaction(async (tx) => {
        if (existing.role === "admin" && input.role !== "admin") {
          if ((await lockedAdminCount(tx, existing.spaceId)) <= 1) {
            throw new ORPCError("BAD_REQUEST", {
              message: "A space must keep at least one admin",
            });
          }
        }
        await tx.update(spaceMember).set({ role: input.role }).where(eq(spaceMember.id, input.id));
      });
      return loadSpaceMember(context.db, input.id);
    }),

  remove: protectedProcedure
    .route({
      method: "DELETE",
      path: "/space-members/{id}",
      tags: TAGS,
      summary: "Remove a member from a space",
    })
    .input(RemoveSpaceMemberInputSchema)
    .output(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const existing = await loadSpaceMember(context.db, input.id);
      const spaceRow = await loadSpace(context.db, existing.spaceId);
      await requireSpaceManage(context.db, context, context.headers, spaceRow, {
        space: ["update"],
      });
      await context.db.transaction(async (tx) => {
        if (existing.role === "admin" && (await lockedAdminCount(tx, existing.spaceId)) <= 1) {
          throw new ORPCError("BAD_REQUEST", { message: "A space must keep at least one admin" });
        }
        await tx.delete(spaceMember).where(eq(spaceMember.id, input.id));
      });
      return { id: input.id };
    }),
};
