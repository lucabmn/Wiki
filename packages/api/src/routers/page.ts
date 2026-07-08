import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { page, pageDraft, pageRevision } from "@nilovon-wiki/db/schema/index";

import { assertOrgPermission, protectedProcedure } from "../index";
import { assertSpaceRead } from "../lib/access";
import { recordActivity } from "../lib/activity";
import { generateKeyBetween } from "../lib/fractional";
import { loadPage, loadSpace, orgOfSpace } from "../lib/loaders";
import { extractPageLinks, syncPageLinks } from "../lib/page-links";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CreatePageInputSchema,
  ListPagesInputSchema,
  MovePageInputSchema,
  PageDraftSchema,
  PageRevisionSchema,
  PageSchema,
  SaveDraftInputSchema,
  UpdatePageInputSchema,
} from "../schemas/page";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Pages"];

/** Sibling scope predicate: same space, same parent (null-aware). */
function siblingsOf(spaceId: string, parentId: string | null) {
  return and(
    eq(page.spaceId, spaceId),
    parentId === null ? isNull(page.parentId) : eq(page.parentId, parentId),
  );
}

/** Position at the end of a sibling list (after the last child). */
async function positionAtEnd(
  db: Database,
  spaceId: string,
  parentId: string | null,
  excludeId?: string,
): Promise<string> {
  const last = await db.query.page.findFirst({
    where: excludeId
      ? and(siblingsOf(spaceId, parentId), sql`${page.id} <> ${excludeId}`)
      : siblingsOf(spaceId, parentId),
    orderBy: [desc(page.position)],
    columns: { position: true },
  });
  return generateKeyBetween(last?.position ?? null, null);
}

/**
 * Walks the ancestor chain of `parentId` to ensure `movedId` is not among its
 * ancestors — otherwise the move would create a cycle in the page tree.
 */
async function assertNoCycle(
  db: Database,
  movedId: string,
  parentId: string | null,
): Promise<void> {
  let cursor = parentId;
  while (cursor) {
    if (cursor === movedId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Cannot move a page underneath itself",
      });
    }
    const parent = await db.query.page.findFirst({
      where: eq(page.id, cursor),
      columns: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

/** Resolves a reorder request into a fractional position within the parent. */
async function positionForMove(
  db: Database,
  spaceId: string,
  parentId: string | null,
  movedId: string,
  beforeId?: string,
  afterId?: string,
): Promise<string> {
  const not = sql`${page.id} <> ${movedId}`;
  if (afterId) {
    const anchor = await loadPage(db, afterId);
    const next = await db.query.page.findFirst({
      where: and(siblingsOf(spaceId, parentId), gt(page.position, anchor.position), not),
      orderBy: [asc(page.position)],
      columns: { position: true },
    });
    return generateKeyBetween(anchor.position, next?.position ?? null);
  }
  if (beforeId) {
    const anchor = await loadPage(db, beforeId);
    const prev = await db.query.page.findFirst({
      where: and(siblingsOf(spaceId, parentId), lt(page.position, anchor.position), not),
      orderBy: [desc(page.position)],
      columns: { position: true },
    });
    return generateKeyBetween(prev?.position ?? null, anchor.position);
  }
  return positionAtEnd(db, spaceId, parentId, movedId);
}

export const pageRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/pages", tags: TAGS, summary: "List pages in a space" })
    .input(ListPagesInputSchema)
    .output(z.array(PageSchema))
    .handler(async ({ input, context }) => {
      await assertSpaceRead(context.db, context, await loadSpace(context.db, input.spaceId));
      return context.db.query.page.findMany({
        where: and(
          eq(page.spaceId, input.spaceId),
          input.parentId === undefined
            ? undefined
            : input.parentId === null
              ? isNull(page.parentId)
              : eq(page.parentId, input.parentId),
          input.status ? eq(page.status, input.status) : undefined,
          input.includeArchived ? undefined : isNull(page.archivedAt),
        ),
        orderBy: [asc(page.position)],
      });
    }),

  get: protectedProcedure
    .route({ method: "GET", path: "/pages/{id}", tags: TAGS, summary: "Get a page" })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const row = await loadPage(context.db, input.id);
      await assertSpaceRead(context.db, context, await loadSpace(context.db, row.spaceId));
      return row;
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/pages", tags: TAGS, summary: "Create a page" })
    .input(CreatePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const organizationId = await orgOfSpace(context.db, input.spaceId);
      await assertOrgPermission(context.headers, { page: ["create"] }, organizationId);

      const parentId = input.parentId ?? null;
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.title),
        async (candidate) =>
          !!(await context.db.query.page.findFirst({
            where: and(eq(page.spaceId, input.spaceId), eq(page.slug, candidate)),
          })),
      );
      const position = await positionAtEnd(context.db, input.spaceId, parentId);
      const userId = context.session?.user.id;

      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(page)
          .values({
            spaceId: input.spaceId,
            parentId,
            title: input.title,
            slug,
            icon: input.icon ?? null,
            coverImage: input.coverImage ?? null,
            content: input.content ?? null,
            textContent: input.textContent,
            isTemplate: input.isTemplate,
            position,
            createdBy: userId,
            lastEditedBy: userId,
          })
          .returning();
        const row = firstRow(rows);
        if (input.content !== undefined) {
          await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(input.content));
        }
        await recordActivity(tx, {
          organizationId,
          action: "page.created",
          actorId: userId,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/pages/{id}", tags: TAGS, summary: "Update a page" })
    .input(UpdatePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      await assertOrgPermission(context.headers, { page: ["update"] }, organizationId);
      const { id, ...patch } = input;
      // A caller-supplied slug is de-duplicated within the space (excluding this
      // page) so it can't collide on `page_space_slug_uq` and surface as a 500.
      if (patch.slug !== undefined) {
        patch.slug = await uniqueSlug(
          patch.slug,
          async (candidate) =>
            !!(await context.db.query.page.findFirst({
              where: and(
                eq(page.spaceId, existing.spaceId),
                eq(page.slug, candidate),
                sql`${page.id} <> ${id}`,
              ),
            })),
        );
      }
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ ...patch, lastEditedBy: context.session?.user.id })
          .where(eq(page.id, id))
          .returning();
        const row = firstRow(rows);
        if (patch.content !== undefined) {
          await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(patch.content));
        }
        await recordActivity(tx, {
          organizationId,
          action: "page.updated",
          actorId: context.session?.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  publish: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/publish",
      tags: TAGS,
      summary: "Publish a page and snapshot a revision",
    })
    .input(z.object({ id: IdSchema, summary: z.string().max(500).optional() }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      await assertOrgPermission(
        context.headers,
        { page: ["publish"] },
        await orgOfSpace(context.db, existing.spaceId),
      );
      const userId = context.session?.user.id;
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      return context.db.transaction(async (tx) => {
        const latest = await tx.query.pageRevision.findFirst({
          where: eq(pageRevision.pageId, existing.id),
          orderBy: [desc(pageRevision.version)],
          columns: { version: true },
        });
        await tx.insert(pageRevision).values({
          pageId: existing.id,
          version: (latest?.version ?? 0) + 1,
          title: existing.title,
          content: existing.content,
          textContent: existing.textContent,
          summary: input.summary ?? null,
          editedBy: userId,
        });
        const rows = await tx
          .update(page)
          .set({ status: "published", publishedAt: new Date(), lastEditedBy: userId })
          .where(eq(page.id, existing.id))
          .returning();
        await recordActivity(tx, {
          organizationId,
          action: "page.published",
          actorId: userId,
          spaceId: existing.spaceId,
          pageId: existing.id,
          metadata: { title: existing.title },
        });
        return firstRow(rows);
      });
    }),

  move: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/move",
      tags: TAGS,
      summary: "Move or reorder a page within its space",
    })
    .input(MovePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      await assertOrgPermission(context.headers, { page: ["move"] }, organizationId);
      const parentId = input.parentId === undefined ? existing.parentId : input.parentId;
      await assertNoCycle(context.db, existing.id, parentId);
      const position = await positionForMove(
        context.db,
        existing.spaceId,
        parentId,
        existing.id,
        input.beforeId,
        input.afterId,
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ parentId, position, lastEditedBy: context.session?.user.id })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.moved",
          actorId: context.session?.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  archive: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/archive",
      tags: TAGS,
      summary: "Soft-archive a page",
    })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      await assertOrgPermission(context.headers, { page: ["update"] }, organizationId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({
            status: "archived",
            archivedAt: new Date(),
            lastEditedBy: context.session?.user.id,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.archived",
          actorId: context.session?.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  restore: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/restore",
      tags: TAGS,
      summary: "Restore an archived page to draft",
    })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      await assertOrgPermission(context.headers, { page: ["update"] }, organizationId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ status: "draft", archivedAt: null, lastEditedBy: context.session?.user.id })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.restored",
          actorId: context.session?.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{id}",
      tags: TAGS,
      summary: "Permanently delete a page and its subtree",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      await assertOrgPermission(context.headers, { page: ["delete"] }, organizationId);
      await context.db.transaction(async (tx) => {
        // `parentId` self-reference cascades, so children are removed with it.
        await tx.delete(page).where(eq(page.id, existing.id));
        // `activity.pageId` is set-null on delete, so keep the id/title in
        // metadata — the audit row must survive the page it describes.
        await recordActivity(tx, {
          organizationId,
          action: "page.deleted",
          actorId: context.session?.user.id,
          spaceId: existing.spaceId,
          metadata: { pageId: existing.id, title: existing.title },
        });
      });
      return { id: existing.id };
    }),

  // --- Revisions ---------------------------------------------------------

  listRevisions: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{id}/revisions",
      tags: TAGS,
      summary: "List a page's version history",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.array(PageRevisionSchema))
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      await assertSpaceRead(context.db, context, await loadSpace(context.db, existing.spaceId));
      return context.db.query.pageRevision.findMany({
        where: eq(pageRevision.pageId, existing.id),
        orderBy: [desc(pageRevision.version)],
      });
    }),

  restoreRevision: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/revisions/{version}/restore",
      tags: TAGS,
      summary: "Restore a page to an earlier revision",
    })
    .input(z.object({ id: IdSchema, version: z.coerce.number().int().positive() }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      await assertOrgPermission(context.headers, { page: ["update"] }, organizationId);
      const revision = await context.db.query.pageRevision.findFirst({
        where: and(eq(pageRevision.pageId, existing.id), eq(pageRevision.version, input.version)),
      });
      if (!revision) {
        throw new ORPCError("NOT_FOUND", { message: "Revision not found" });
      }
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({
            title: revision.title,
            content: revision.content,
            textContent: revision.textContent,
            lastEditedBy: context.session?.user.id,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(revision.content));
        await recordActivity(tx, {
          organizationId,
          action: "page.updated",
          actorId: context.session?.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title, restoredVersion: revision.version },
        });
        return row;
      });
    }),

  // --- Per-user drafts ---------------------------------------------------

  getDraft: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{id}/draft",
      tags: TAGS,
      summary: "Get the caller's autosave draft for a page",
    })
    .input(z.object({ id: IdSchema }))
    .output(PageDraftSchema.nullable())
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      await assertSpaceRead(context.db, context, await loadSpace(context.db, existing.spaceId));
      const row = await context.db.query.pageDraft.findFirst({
        where: and(
          eq(pageDraft.pageId, existing.id),
          eq(pageDraft.userId, context.session!.user.id),
        ),
      });
      return row ?? null;
    }),

  saveDraft: protectedProcedure
    .route({
      method: "PUT",
      path: "/pages/{pageId}/draft",
      tags: TAGS,
      summary: "Upsert the caller's autosave draft for a page",
    })
    .input(SaveDraftInputSchema)
    .output(PageDraftSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.pageId);
      // Drafting requires write access to the page.
      await assertOrgPermission(
        context.headers,
        { page: ["update"] },
        await orgOfSpace(context.db, existing.spaceId),
      );
      const userId = context.session!.user.id;
      const rows = await context.db
        .insert(pageDraft)
        .values({
          pageId: existing.id,
          userId,
          title: input.title ?? null,
          content: input.content ?? null,
        })
        .onConflictDoUpdate({
          target: [pageDraft.pageId, pageDraft.userId],
          set: { title: input.title ?? null, content: input.content ?? null },
        })
        .returning();
      return firstRow(rows);
    }),

  deleteDraft: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{id}/draft",
      tags: TAGS,
      summary: "Discard the caller's autosave draft for a page",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ pageId: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      await assertSpaceRead(context.db, context, await loadSpace(context.db, existing.spaceId));
      await context.db
        .delete(pageDraft)
        .where(
          and(eq(pageDraft.pageId, existing.id), eq(pageDraft.userId, context.session!.user.id)),
        );
      return { pageId: existing.id };
    }),
};
