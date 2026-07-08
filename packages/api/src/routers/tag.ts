import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import type { Database } from "@nilovon-wiki/db";
import { pageTag, tag } from "@nilovon-wiki/db/schema/index";

import { assertActiveOrgRead, assertOrgPermission, protectedProcedure } from "../index";
import { loadPage, orgOfSpace } from "../lib/loaders";
import { firstRow } from "../lib/rows";
import { IdSchema } from "../schemas/shared";
import {
  CreateTagInputSchema,
  ListTagsInputSchema,
  PageTagInputSchema,
  TagSchema,
  UpdateTagInputSchema,
} from "../schemas/tag";

const TAGS = ["Tags"];

// Tags are space content with no dedicated permission in the statement; managing
// them is gated behind `page:update` (content-editor rights).
const MANAGE: PermissionRequest = { page: ["update"] };

export const tagRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/tags", tags: TAGS, summary: "List tags in a space" })
    .input(ListTagsInputSchema)
    .output(z.array(TagSchema))
    .handler(async ({ input, context }) => {
      assertActiveOrgRead(context, await orgOfSpace(context.db, input.spaceId));
      return context.db.query.tag.findMany({
        where: eq(tag.spaceId, input.spaceId),
        orderBy: [asc(tag.name)],
      });
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/tags", tags: TAGS, summary: "Create a tag" })
    .input(CreateTagInputSchema)
    .output(TagSchema)
    .handler(async ({ input, context }) => {
      await assertOrgPermission(
        context.headers,
        MANAGE,
        await orgOfSpace(context.db, input.spaceId),
      );
      const rows = await context.db
        .insert(tag)
        .values({ spaceId: input.spaceId, name: input.name, color: input.color ?? null })
        .returning();
      return firstRow(rows);
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/tags/{id}", tags: TAGS, summary: "Update a tag" })
    .input(UpdateTagInputSchema)
    .output(TagSchema)
    .handler(async ({ input, context }) => {
      const existing = await context.db.query.tag.findFirst({ where: eq(tag.id, input.id) });
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Tag not found" });
      }
      await assertOrgPermission(
        context.headers,
        MANAGE,
        await orgOfSpace(context.db, existing.spaceId),
      );
      const { id, ...patch } = input;
      const rows = await context.db.update(tag).set(patch).where(eq(tag.id, id)).returning();
      return firstRow(rows);
    }),

  delete: protectedProcedure
    .route({ method: "DELETE", path: "/tags/{id}", tags: TAGS, summary: "Delete a tag" })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await context.db.query.tag.findFirst({ where: eq(tag.id, input.id) });
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Tag not found" });
      }
      await assertOrgPermission(
        context.headers,
        MANAGE,
        await orgOfSpace(context.db, existing.spaceId),
      );
      await context.db.delete(tag).where(eq(tag.id, input.id));
      return { id: input.id };
    }),

  // --- Page <-> tag assignment ------------------------------------------

  attach: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{pageId}/tags",
      tags: TAGS,
      summary: "Tag a page",
    })
    .input(PageTagInputSchema)
    .output(z.array(TagSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      await assertOrgPermission(
        context.headers,
        MANAGE,
        await orgOfSpace(context.db, target.spaceId),
      );
      // The tag must live in the same space as the page — the FK only checks
      // existence, so without this a cross-space (or cross-org) tag could attach.
      const tagRow = await context.db.query.tag.findFirst({
        where: eq(tag.id, input.tagId),
        columns: { spaceId: true },
      });
      if (!tagRow || tagRow.spaceId !== target.spaceId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Tag does not belong to the page's space",
        });
      }
      await context.db
        .insert(pageTag)
        .values({ pageId: input.pageId, tagId: input.tagId })
        .onConflictDoNothing();
      return listPageTags(context.db, input.pageId);
    }),

  detach: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{pageId}/tags/{tagId}",
      tags: TAGS,
      summary: "Remove a tag from a page",
    })
    .input(PageTagInputSchema)
    .output(z.array(TagSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      await assertOrgPermission(
        context.headers,
        MANAGE,
        await orgOfSpace(context.db, target.spaceId),
      );
      await context.db
        .delete(pageTag)
        .where(and(eq(pageTag.pageId, input.pageId), eq(pageTag.tagId, input.tagId)));
      return listPageTags(context.db, input.pageId);
    }),

  listForPage: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{pageId}/tags",
      tags: TAGS,
      summary: "List a page's tags",
    })
    .input(z.object({ pageId: IdSchema }))
    .output(z.array(TagSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      assertActiveOrgRead(context, await orgOfSpace(context.db, target.spaceId));
      return listPageTags(context.db, input.pageId);
    }),
};

async function listPageTags(db: Database, pageId: string) {
  const rows = await db
    .select({ tag })
    .from(pageTag)
    .innerJoin(tag, eq(pageTag.tagId, tag.id))
    .where(eq(pageTag.pageId, pageId))
    .orderBy(asc(tag.name));
  return rows.map((r) => r.tag);
}
