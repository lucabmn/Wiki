import { ORPCError } from "@orpc/server";
import { eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { page, pageMember, team, user } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requirePageCapability, requirePageManage, resolveMyPageAccess } from "../lib/authz";
import { loadPage } from "../lib/loaders";
import { assertPermissionSubjectInOrganization } from "../lib/permission-subject";
import { IdSchema } from "../schemas/shared";
import {
  AddPageMemberInputSchema,
  MyPageRoleSchema,
  PageAccessSchema,
  PageMemberSchema,
  RemovePageMemberInputSchema,
  SetPageVisibilityInputSchema,
  UpdatePageMemberInputSchema,
} from "../schemas/page";

const TAGS = ["Page access"];

function selectPageMembers(db: Database, where: SQL) {
  return db
    .select({
      id: pageMember.id,
      pageId: pageMember.pageId,
      subject: pageMember.subject,
      role: pageMember.role,
      roleName: pageMember.roleName,
      createdAt: pageMember.createdAt,
      user: { id: user.id, name: user.name, email: user.email },
      team: { id: team.id, name: team.name },
    })
    .from(pageMember)
    .leftJoin(user, eq(pageMember.userId, user.id))
    .leftJoin(team, eq(pageMember.teamId, team.id))
    .where(where);
}

async function loadPageMember(db: Database, id: string) {
  const rows = await selectPageMembers(db, eq(pageMember.id, id));
  const row = rows[0];
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Page member not found" });
  return row;
}

/**
 * Names the grantee in a form that outlives the row it describes.
 *
 * An audit entry saying "a grant was removed" answers nothing; the whole point
 * is *whose* access changed, and the `pageMember` row is gone by the time
 * anybody reads the log. So the subject's display name is denormalized into the
 * activity metadata, exactly as page titles already are.
 */
function grantee(row: Awaited<ReturnType<typeof loadPageMember>>): Record<string, unknown> {
  return {
    subject: row.subject,
    subjectId: row.user?.id ?? row.team?.id ?? row.roleName ?? null,
    subjectName: row.user?.name ?? row.team?.name ?? row.roleName ?? null,
    // Only for a user grant, and only because "who exactly" is the question an
    // access audit gets asked, and two people share a display name more often
    // than anyone expects.
    subjectEmail: row.user?.email ?? null,
  };
}

export const pageAccessRouter = {
  myRole: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{pageId}/my-access",
      tags: TAGS,
      summary: "The caller's effective access to a page",
    })
    .input(z.object({ pageId: IdSchema }))
    .output(MyPageRoleSchema)
    .handler(async ({ input, context }) => {
      const pageRow = await loadPage(context.db, input.pageId);
      return resolveMyPageAccess(context.db, context, context.headers, pageRow);
    }),

  get: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{pageId}/access",
      tags: TAGS,
      summary: "A page's visibility override and members",
    })
    .input(z.object({ pageId: IdSchema }))
    .output(PageAccessSchema)
    .handler(async ({ input, context }) => {
      const pageRow = await loadPage(context.db, input.pageId);
      await requirePageCapability(context.db, context, context.headers, pageRow, "read");
      const members = await selectPageMembers(context.db, eq(pageMember.pageId, input.pageId));
      return { pageId: input.pageId, visibility: pageRow.visibility, members };
    }),

  setVisibility: protectedProcedure
    .route({
      method: "PATCH",
      path: "/pages/{pageId}/visibility",
      tags: TAGS,
      summary: "Set or clear a page's visibility override",
    })
    .input(SetPageVisibilityInputSchema)
    .output(z.object({ pageId: IdSchema, visibility: z.string().nullable() }))
    .handler(async ({ input, context }) => {
      const pageRow = await loadPage(context.db, input.pageId);
      const { organizationId } = await requirePageManage(
        context.db,
        context,
        context.headers,
        pageRow,
      );
      await context.db.transaction(async (tx) => {
        await tx
          .update(page)
          .set({ visibility: input.visibility })
          .where(eq(page.id, input.pageId));
        await recordActivity(tx, {
          organizationId,
          action: "page.access_changed",
          ...activityActor(context),
          spaceId: pageRow.spaceId,
          pageId: pageRow.id,
          metadata: {
            title: pageRow.title,
            // Both sides: "restricted" alone does not say whether access was
            // tightened or loosened, and that is the whole question.
            from: pageRow.visibility,
            to: input.visibility,
          },
        });
      });
      return { pageId: input.pageId, visibility: input.visibility };
    }),

  addMember: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{pageId}/members",
      tags: TAGS,
      summary: "Grant a user or team access to a page",
    })
    .input(AddPageMemberInputSchema)
    .output(PageMemberSchema)
    .handler(async ({ input, context }) => {
      const pageRow = await loadPage(context.db, input.pageId);
      const { organizationId } = await requirePageManage(
        context.db,
        context,
        context.headers,
        pageRow,
      );
      await assertPermissionSubjectInOrganization(context.db, organizationId, input);
      const rows = await context.db
        .insert(pageMember)
        .values({
          pageId: input.pageId,
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
        throw new ORPCError("CONFLICT", { message: "Already has access to this page" });
      }
      const created = await loadPageMember(context.db, inserted.id);
      await recordActivity(context.db, {
        organizationId,
        action: "page.member_added",
        ...activityActor(context),
        spaceId: pageRow.spaceId,
        pageId: pageRow.id,
        metadata: { title: pageRow.title, role: created.role, ...grantee(created) },
      });
      return created;
    }),

  updateRole: protectedProcedure
    .route({
      method: "PATCH",
      path: "/page-members/{id}",
      tags: TAGS,
      summary: "Change a page member's role",
    })
    .input(UpdatePageMemberInputSchema)
    .output(PageMemberSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPageMember(context.db, input.id);
      const pageRow = await loadPage(context.db, existing.pageId);
      const { organizationId } = await requirePageManage(
        context.db,
        context,
        context.headers,
        pageRow,
      );
      await context.db
        .update(pageMember)
        .set({ role: input.role })
        .where(eq(pageMember.id, input.id));
      await recordActivity(context.db, {
        organizationId,
        action: "page.member_role_changed",
        ...activityActor(context),
        spaceId: pageRow.spaceId,
        pageId: pageRow.id,
        metadata: {
          title: pageRow.title,
          from: existing.role,
          to: input.role,
          ...grantee(existing),
        },
      });
      return loadPageMember(context.db, input.id);
    }),

  removeMember: protectedProcedure
    .route({
      method: "DELETE",
      path: "/page-members/{id}",
      tags: TAGS,
      summary: "Revoke a member's page access",
    })
    .input(RemovePageMemberInputSchema)
    .output(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const existing = await loadPageMember(context.db, input.id);
      const pageRow = await loadPage(context.db, existing.pageId);
      const { organizationId } = await requirePageManage(
        context.db,
        context,
        context.headers,
        pageRow,
      );
      await context.db.transaction(async (tx) => {
        await tx.delete(pageMember).where(eq(pageMember.id, input.id));
        // Inside the transaction and *after* the delete: a revocation that was
        // rolled back must not be in the log, and one that succeeded must be.
        await recordActivity(tx, {
          organizationId,
          action: "page.member_removed",
          ...activityActor(context),
          spaceId: pageRow.spaceId,
          pageId: pageRow.id,
          metadata: { title: pageRow.title, role: existing.role, ...grantee(existing) },
        });
      });
      return { id: input.id };
    }),
};
