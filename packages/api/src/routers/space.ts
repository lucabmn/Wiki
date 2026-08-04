import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { space, spaceMember } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { assertSpaceRead, buildSpaceReadFilter } from "../lib/access";
import { requireSpaceManage } from "../lib/authz";
import { recordActivity } from "../lib/activity";
import { spaceNotTrashed } from "../lib/lifecycle";
import { loadSpace } from "../lib/loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { assertSpaceDeletable } from "../lib/retention/holds";
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
            // Trashed spaces are only reachable through the trash view, even
            // when archived rows are requested — the two states are unrelated.
            spaceNotTrashed(),
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
      // uniqueSlug pre-checks, but concurrent creates can still race onto the
      // (organizationId, slug) unique index; surface that as a 409, not a 500.
      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
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
          }),
        "A space with this slug already exists in the organization",
      );
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
      // Space admins manage their own space; org-wide `space:["update"]` still
      // works too. Gated on the resource's own org, not the active org.
      await requireSpaceManage(context.db, context, context.headers, existing, {
        space: ["update"],
      });
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
      await requireSpaceManage(context.db, context, context.headers, existing, {
        space: ["update"],
      });
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

  restore: protectedProcedure
    .route({
      method: "POST",
      path: "/spaces/{id}/restore",
      tags: TAGS,
      summary: "Un-archive a space",
    })
    .input(z.object({ id: IdSchema }))
    .output(SpaceSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadSpace(context.db, input.id);
      await requireSpaceManage(context.db, context, context.headers, existing, {
        space: ["update"],
      });
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(space)
          .set({ archivedAt: null })
          .where(eq(space.id, input.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId: existing.organizationId,
          action: "space.restored",
          actorId: context.session.user.id,
          spaceId: row.id,
        });
        return row;
      });
    }),

  /**
   * Soft delete: the space moves to the trash and vanishes from every view, but
   * survives — with its pages, comments and attachments — until the org's trash
   * window expires or someone purges it explicitly (`trash.purgeSpace`).
   *
   * This used to cascade immediately. It no longer does, and that is the point:
   * "Delete space" was the one button in the product that could destroy a year
   * of writing with no way back.
   */
  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/spaces/{id}",
      tags: TAGS,
      summary: "Move a space to the trash",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadSpace(context.db, input.id);
      // Space admin, or the org-wide `space:["delete"]` grant.
      await requireSpaceManage(context.db, context, context.headers, existing, {
        space: ["delete"],
      });
      // Blocked when the space — or any page inside it — is under a deletion
      // block: trashing the space would put a held page beyond reach.
      await assertSpaceDeletable(context.db, existing);
      return context.db.transaction(async (tx) => {
        await tx
          .update(space)
          .set({ deletedAt: new Date(), deletedBy: context.session.user.id })
          .where(eq(space.id, input.id));
        // The row survives, but the name stays denormalized here so the feed
        // still reads correctly once the purge removes it for good.
        await recordActivity(tx, {
          organizationId: existing.organizationId,
          action: "space.deleted",
          actorId: context.session.user.id,
          spaceId: existing.id,
          metadata: { spaceId: existing.id, name: existing.name },
        });
        return { id: input.id };
      });
    }),
};
