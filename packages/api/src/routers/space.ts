import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { space } from "@nilovon-wiki/db/schema/index";

import {
  assertOrgPermission,
  protectedProcedure,
  requireActiveOrg,
  requireOrgPermission,
} from "../index";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CreateSpaceInputSchema,
  ListSpacesInputSchema,
  SpaceSchema,
  UpdateSpaceInputSchema,
} from "../schemas/space";
import { IdSchema } from "../schemas/shared";
import type { Context } from "../context";

const TAGS = ["Spaces"];

/**
 * Loads a space by id or throws NOT_FOUND. Shared by every resource-targeting
 * route so the not-found shape stays consistent.
 */
async function getSpaceOrThrow(db: Context["db"], id: string) {
  const row = await db.query.space.findFirst({ where: eq(space.id, id) });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Space not found" });
  }
  return row;
}

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
      const organizationId = input.organizationId ?? requireActiveOrg(context);
      // Reads are scoped to the caller's active org; cross-org reads are denied
      // to avoid leaking spaces the caller has no membership in.
      if (organizationId !== requireActiveOrg(context)) {
        throw new ORPCError("FORBIDDEN");
      }
      return context.db.query.space.findMany({
        where: and(
          eq(space.organizationId, organizationId),
          input.includeArchived ? undefined : isNull(space.archivedAt),
        ),
        orderBy: [desc(space.createdAt)],
      });
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
      const row = await getSpaceOrThrow(context.db, input.id);
      if (row.organizationId !== requireActiveOrg(context)) {
        throw new ORPCError("FORBIDDEN");
      }
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
      const rows = await context.db
        .insert(space)
        .values({
          organizationId,
          slug,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          color: input.color ?? null,
          visibility: input.visibility,
          createdBy: context.session?.user.id,
        })
        .returning();
      return firstRow(rows);
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
      const existing = await getSpaceOrThrow(context.db, input.id);
      // Gate on the resource's own org — not the active org — so rights in one
      // org can't authorize edits to a space living in another.
      await assertOrgPermission(context.headers, { space: ["update"] }, existing.organizationId);
      const { id, ...patch } = input;
      const rows = await context.db.update(space).set(patch).where(eq(space.id, id)).returning();
      return firstRow(rows);
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
      const existing = await getSpaceOrThrow(context.db, input.id);
      await assertOrgPermission(context.headers, { space: ["update"] }, existing.organizationId);
      const rows = await context.db
        .update(space)
        .set({ archivedAt: new Date() })
        .where(eq(space.id, input.id))
        .returning();
      return firstRow(rows);
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
      const existing = await getSpaceOrThrow(context.db, input.id);
      // Hard delete is the destructive `space:["delete"]` grant (owner/admin);
      // cascades remove pages, comments, attachments, etc.
      await assertOrgPermission(context.headers, { space: ["delete"] }, existing.organizationId);
      await context.db.delete(space).where(eq(space.id, input.id));
      return { id: input.id };
    }),
};
