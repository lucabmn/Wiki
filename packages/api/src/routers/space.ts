import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { space, spaceMember } from "@nilovon-wiki/db/schema/index";

import {
  assertOrgPermission,
  protectedProcedure,
  requireActiveOrg,
  requireOrgPermission,
} from "../index";
import { assertSpaceRead, buildSpaceReadFilter } from "../lib/access";
import { recordActivity } from "../lib/activity";
import { loadSpace } from "../lib/loaders";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CreateSpaceInputSchema,
  ListSpacesInputSchema,
  SpaceSchema,
  UpdateSpaceInputSchema,
} from "../schemas/space";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Spaces"];

export const spaceRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces",
      tags: TAGS,
      summary: "List spaces in the active organization",
    })
    .input(ListSpacesInputSchema)
    .output(z.array(SpaceSchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      // The input field stays for API-surface compatibility, but only the
      // active org may be listed — anything else is a cross-org read.
      if (input.organizationId && input.organizationId !== organizationId) {
        throw new ORPCError("FORBIDDEN");
      }
      const [candidates, canRead] = await Promise.all([
        context.db.query.space.findMany({
          where: and(
            eq(space.organizationId, organizationId),
            input.includeArchived ? undefined : isNull(space.archivedAt),
          ),
          orderBy: [desc(space.createdAt)],
        }),
        buildSpaceReadFilter(context.db, context),
      ]);
      // Drop spaces the caller can't see (private/restricted without membership).
      return candidates.filter(canRead);
    }),

  get: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces/{id}",
      tags: TAGS,
      summary: "Get a single space",
    })
    .input(z.object({ id: IdSchema }))
    .output(SpaceSchema)
    .handler(async ({ input, context }) => {
      const row = await loadSpace(context.db, input.id);
      await assertSpaceRead(context.db, context, row);
      return row;
    }),

  create: requireOrgPermission({ space: ["create"] })
    .route({
      method: "POST",
      path: "/spaces",
      tags: TAGS,
      summary: "Create a space in the active organization",
    })
    .input(CreateSpaceInputSchema)
    .output(SpaceSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.name),
        async (candidate) =>
          !!(await context.db.query.space.findFirst({
            where: and(eq(space.organizationId, organizationId), eq(space.slug, candidate)),
          })),
      );
      const userId = context.session.user.id;
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(space)
          .values({
            organizationId,
            slug,
            name: input.name,
            description: input.description ?? null,
            icon: input.icon ?? null,
            color: input.color ?? null,
            visibility: input.visibility,
            createdBy: userId,
          })
          .returning();
        const row = firstRow(rows);
        // Grant the creator explicit admin membership so private spaces are
        // usable by their author and they appear in member lists.
        await tx.insert(spaceMember).values({
          spaceId: row.id,
          subject: "user",
          userId,
          role: "admin",
        });
        await recordActivity(tx, {
          organizationId,
          action: "space.created",
          actorId: userId,
          spaceId: row.id,
          metadata: { name: row.name },
        });
        return row;
      });
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/spaces/{id}",
      tags: TAGS,
      summary: "Update a space",
    })
    .input(UpdateSpaceInputSchema)
    .output(SpaceSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadSpace(context.db, input.id);
      // Gate on the resource's own org — not the active org — so rights in one
      // org can't authorize edits to a space living in another.
      await assertOrgPermission(context.headers, { space: ["update"] }, existing.organizationId);
      const { id, ...patch } = input;
      return context.db.transaction(async (tx) => {
        const rows = await tx.update(space).set(patch).where(eq(space.id, id)).returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId: existing.organizationId,
          action: "space.updated",
          actorId: context.session.user.id,
          spaceId: row.id,
        });
        return row;
      });
    }),

  archive: protectedProcedure
    .route({
      method: "POST",
      path: "/spaces/{id}/archive",
      tags: TAGS,
      summary: "Soft-archive a space",
    })
    .input(z.object({ id: IdSchema }))
    .output(SpaceSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadSpace(context.db, input.id);
      await assertOrgPermission(context.headers, { space: ["update"] }, existing.organizationId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(space)
          .set({ archivedAt: new Date() })
          .where(eq(space.id, input.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId: existing.organizationId,
          action: "space.archived",
          actorId: context.session.user.id,
          spaceId: row.id,
        });
        return row;
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/spaces/{id}",
      tags: TAGS,
      summary: "Permanently delete a space and its contents",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadSpace(context.db, input.id);
      // Hard delete is the destructive `space:["delete"]` grant (owner/admin);
      // cascades remove pages, comments, attachments, etc.
      await assertOrgPermission(context.headers, { space: ["delete"] }, existing.organizationId);
      await context.db.transaction(async (tx) => {
        await tx.delete(space).where(eq(space.id, input.id));
        // `activity.spaceId` is set-null on delete, so keep the id/name in
        // metadata — the audit row must survive the space it describes.
        await recordActivity(tx, {
          organizationId: existing.organizationId,
          action: "space.deleted",
          actorId: context.session.user.id,
          metadata: { spaceId: existing.id, name: existing.name },
        });
      });
      return { id: input.id };
    }),
};
