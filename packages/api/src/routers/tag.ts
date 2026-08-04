import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { page, pageTag, tag } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { assertSpaceRead } from "../lib/access";
import {
  filterReadablePagesAcrossSpaces,
  requirePageCapability,
  requireSpaceCapabilityById,
} from "../lib/authz";
import { pageNotTrashed } from "../lib/lifecycle";
import { loadPage, loadSpace, loadTag } from "../lib/loaders";
import { firstRow } from "../lib/rows";
import { IdSchema } from "../schemas/shared";
import {
  CreateTagInputSchema,
  ListPagesByTagInputSchema,
  ListTagsInputSchema,
  PageTagInputSchema,
  TaggedPageSchema,
  TagSchema,
  TagWithCountSchema,
  UpdateTagInputSchema,
} from "../schemas/tag";

const TAGS = ["Tags"];

export const tagRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/tags", tags: TAGS, summary: "List tags in a space" })
    .input(ListTagsInputSchema)
    .output(z.array(TagSchema))
    .handler(async ({ input, context }) => {
      await assertSpaceRead(context.db, context, await loadSpace(context.db, input.spaceId));
      return context.db.query.tag.findMany({
        where: eq(tag.spaceId, input.spaceId),
        orderBy: [asc(tag.name)],
      });
    }),

  listWithCounts: protectedProcedure
    .route({
      method: "GET",
      path: "/tags/with-counts",
      tags: TAGS,
      summary: "List tags with readable page counts",
    })
    .input(ListTagsInputSchema)
    .output(z.array(TagWithCountSchema))
    .handler(async ({ input, context }) => {
      await assertSpaceRead(context.db, context, await loadSpace(context.db, input.spaceId));

      const tags = await context.db.query.tag.findMany({
        where: eq(tag.spaceId, input.spaceId),
        orderBy: [asc(tag.name)],
      });
      if (tags.length === 0) return [];

      const spacePages = await context.db
        .select({
          id: page.id,
          spaceId: page.spaceId,
          visibility: page.visibility,
          createdBy: page.createdBy,
        })
        .from(page)
        .where(
          and(
            eq(page.spaceId, input.spaceId),
            isNull(page.archivedAt),
            eq(page.status, "published"),
            pageNotTrashed(),
          ),
        );
      const readablePages = await filterReadablePagesAcrossSpaces(
        context.db,
        context,
        context.headers,
        spacePages,
      );
      const readablePageIds = readablePages.map((page) => page.id);
      if (readablePageIds.length === 0) {
        return tags.map((tag) => ({ ...tag, pageCount: 0 }));
      }

      const tagRows = await context.db
        .select({ tagId: pageTag.tagId })
        .from(pageTag)
        .where(inArray(pageTag.pageId, readablePageIds));
      const counts = new Map<string, number>();
      for (const row of tagRows) counts.set(row.tagId, (counts.get(row.tagId) ?? 0) + 1);
      return tags.map((tag) => ({ ...tag, pageCount: counts.get(tag.id) ?? 0 }));
    }),

  listPages: protectedProcedure
    .route({
      method: "GET",
      path: "/tags/{tagId}/pages",
      tags: TAGS,
      summary: "List readable pages for a tag",
    })
    .input(ListPagesByTagInputSchema)
    .output(z.array(TaggedPageSchema))
    .handler(async ({ input, context }) => {
      const existing = await loadTag(context.db, input.tagId);
      await assertSpaceRead(context.db, context, await loadSpace(context.db, existing.spaceId));

      const rows = await context.db
        .select({
          pageId: page.id,
          spaceId: page.spaceId,
          title: page.title,
          slug: page.slug,
          icon: page.icon,
          updatedAt: page.updatedAt,
          id: page.id,
          visibility: page.visibility,
          createdBy: page.createdBy,
        })
        .from(pageTag)
        .innerJoin(page, eq(pageTag.pageId, page.id))
        .where(
          and(
            eq(pageTag.tagId, input.tagId),
            isNull(page.archivedAt),
            eq(page.status, "published"),
            pageNotTrashed(),
          ),
        )
        .orderBy(desc(page.updatedAt))
        .limit(input.limit);

      return filterReadablePagesAcrossSpaces(context.db, context, context.headers, rows);
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/tags", tags: TAGS, summary: "Create a tag" })
    .input(CreateTagInputSchema)
    .output(TagSchema)
    .handler(async ({ input, context }) => {
      await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        input.spaceId,
        "write",
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
      const existing = await loadTag(context.db, input.id);
      await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        existing.spaceId,
        "write",
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
      const existing = await loadTag(context.db, input.id);
      await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        existing.spaceId,
        "write",
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
      await requirePageCapability(context.db, context, context.headers, target, "write");
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
      await requirePageCapability(context.db, context, context.headers, target, "write");
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
      await requirePageCapability(context.db, context, context.headers, target, "read");
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
