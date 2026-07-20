import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { page, pageRevision } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { isOrgManager, protectedProcedure } from "../index";
import { filterReadablePages, loadSpaceRole } from "../lib/access";
import { requirePageCapability, requireSpaceCapabilityById } from "../lib/authz";
import { recordActivity } from "../lib/activity";
import { COLLAB_TOKEN_TTL_SECONDS, collabDocName, signCollabToken } from "../lib/collab-token";
import { generateKeyBetween } from "../lib/fractional";
import { loadPage, loadSpace } from "../lib/loaders";
import { extractPageLinks, syncPageLinks } from "../lib/page-links";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CreatePageInputSchema,
  ListPagesInputSchema,
  MovePageInputSchema,
  PageRevisionSchema,
  PageSchema,
  PublishPageInputSchema,
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
 * Ensures a requested parent page exists in `spaceId`. Without this, a
 * client-supplied `parentId` could point into another space (or another org's
 * space), corrupting the tree and doubling as a page-existence oracle.
 */
async function assertParentInSpace(
  db: Database,
  parentId: string | null,
  spaceId: string,
): Promise<void> {
  if (!parentId) return;
  const parent = await db.query.page.findFirst({
    where: eq(page.id, parentId),
    columns: { spaceId: true },
  });
  if (!parent || parent.spaceId !== spaceId) {
    throw new ORPCError("BAD_REQUEST", { message: "Parent page is not in this space" });
  }
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
      const spaceRow = await loadSpace(context.db, input.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const spaceRole = await loadSpaceRole(context.db, context, spaceRow, manager);
      if (spaceRole === null) throw new ORPCError("FORBIDDEN");
      const rows = await context.db.query.page.findMany({
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
      // Drop pages restricted by a per-page override the caller can't read.
      return filterReadablePages(context.db, context, rows, spaceRole);
    }),

  get: protectedProcedure
    .route({ method: "GET", path: "/pages/{id}", tags: TAGS, summary: "Get a page" })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const row = await loadPage(context.db, input.id);
      await requirePageCapability(context.db, context, context.headers, row, "read");
      return row;
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/pages", tags: TAGS, summary: "Create a page" })
    .input(CreatePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const { organizationId } = await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        input.spaceId,
        "write",
      );

      const parentId = input.parentId ?? null;
      await assertParentInSpace(context.db, parentId, input.spaceId);
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.title),
        async (candidate) =>
          !!(await context.db.query.page.findFirst({
            where: and(eq(page.spaceId, input.spaceId), eq(page.slug, candidate)),
          })),
      );
      const position = await positionAtEnd(context.db, input.spaceId, parentId);
      const userId = context.session.user.id;

      // uniqueSlug pre-checks, but two concurrent creates can both pass it and
      // then collide on `page_space_slug_uq`; map that race to a 409, not a 500.
      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
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
          }),
        "A page with this slug already exists in the space",
      );
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/pages/{id}", tags: TAGS, summary: "Update a page" })
    .input(UpdatePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
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
          .set({ ...patch, lastEditedBy: context.session.user.id })
          .where(eq(page.id, id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.updated",
          actorId: context.session.user.id,
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
      summary: "Publish a page: promote the working copy and snapshot a revision",
    })
    .input(PublishPageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      const userId = context.session.user.id;
      // Promote the caller's current working copy into the published projection.
      // Collab only persists the working draft as `yjsState`, so publish is the
      // single point where `content`/`textContent` (and thus the read view,
      // search, and backlinks) advance. Absent input falls back to the last
      // published state, making an API-only re-publish a safe no-content op.
      const nextTitle = input.title?.trim() || existing.title;
      const nextContent = input.content !== undefined ? input.content : existing.content;
      const nextText = input.textContent !== undefined ? input.textContent : existing.textContent;
      return context.db.transaction(async (tx) => {
        const latest = await tx.query.pageRevision.findFirst({
          where: eq(pageRevision.pageId, existing.id),
          orderBy: [desc(pageRevision.version)],
          columns: { version: true },
        });
        await tx.insert(pageRevision).values({
          pageId: existing.id,
          version: (latest?.version ?? 0) + 1,
          title: nextTitle,
          content: nextContent,
          textContent: nextText,
          summary: input.summary ?? null,
          editedBy: userId,
        });
        const rows = await tx
          .update(page)
          .set({
            title: nextTitle,
            content: nextContent,
            textContent: nextText,
            status: "published",
            publishedAt: new Date(),
            lastEditedBy: userId,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        // Backlinks reflect published content only — resynced here, never by the
        // collab store.
        await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(nextContent));
        await recordActivity(tx, {
          organizationId,
          action: "page.published",
          actorId: userId,
          spaceId: existing.spaceId,
          pageId: existing.id,
          metadata: { title: nextTitle },
        });
        return row;
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
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      const parentId = input.parentId === undefined ? existing.parentId : input.parentId;
      await assertParentInSpace(context.db, parentId, existing.spaceId);
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
          .set({ parentId, position, lastEditedBy: context.session.user.id })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.moved",
          actorId: context.session.user.id,
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
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({
            status: "archived",
            archivedAt: new Date(),
            lastEditedBy: context.session.user.id,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.archived",
          actorId: context.session.user.id,
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
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ status: "draft", archivedAt: null, lastEditedBy: context.session.user.id })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.restored",
          actorId: context.session.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
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
      await requirePageCapability(context.db, context, context.headers, existing, "read");
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
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
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
            // Drop the live Yjs snapshot: the collab server prefers `yjsState`
            // over `content` when seeding, so leaving it would make the restore a
            // silent no-op on the next open. Cleared, the next fresh session
            // re-seeds from the restored `content`. (An actively-connected collab
            // session still holds the old doc in memory until all clients
            // disconnect — restore from within the editor takes the live path
            // instead; see `RevisionHistory`'s `onRestore`.)
            yjsState: null,
            lastEditedBy: context.session.user.id,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(revision.content));
        await recordActivity(tx, {
          organizationId,
          action: "page.updated",
          actorId: context.session.user.id,
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title, restoredVersion: revision.version },
        });
        return row;
      });
    }),

  collabToken: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/collab-token",
      tags: TAGS,
      summary: "Mint a short-lived token for the real-time collaboration socket",
    })
    .input(z.object({ id: IdSchema }))
    .output(
      z.object({
        token: z.string(),
        docName: z.string(),
        expiresInSeconds: z.number(),
      }),
    )
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      // The token IS the capability grant, so the full page-write check (incl.
      // the org-manager override and per-page ACLs) runs here, on the
      // authoritative server. The collab process only verifies the signature.
      await requirePageCapability(context.db, context, context.headers, existing, "write");
      const user = context.session.user;
      const token = await signCollabToken(env.BETTER_AUTH_SECRET, {
        u: user.id,
        n: user.name || user.email || "Anonym",
        p: existing.id,
      });
      return {
        token,
        docName: collabDocName(existing.id),
        expiresInSeconds: COLLAB_TOKEN_TTL_SECONDS,
      };
    }),
};
