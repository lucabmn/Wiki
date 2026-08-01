import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { pageExternalLink } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { requirePageCapability } from "../lib/authz";
import { loadExternalLink, loadPage } from "../lib/loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import {
  CreateExternalLinkInputSchema,
  ExternalLinkSchema,
  ListExternalLinksInputSchema,
  MoveExternalLinkInputSchema,
  UpdateExternalLinkInputSchema,
} from "../schemas/external-link";
import { IdSchema } from "../schemas/shared";

const TAGS = ["External links"];

const DUPLICATE_MESSAGE = "This URL is already linked from the page";

/**
 * Curated outbound links of a page. Authorization mirrors the page's own: read
 * access to list them, write access to change them — a link list is part of the
 * page's content, not a separate resource with its own permissions.
 *
 * Every mutation returns the full list so a client never has to reconcile a
 * single row against a cached collection (the same contract `tags.attach` uses),
 * which matters here because reordering touches rows the caller didn't name.
 */
export const externalLinkRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{pageId}/external-links",
      tags: TAGS,
      summary: "List a page's external links",
    })
    .input(ListExternalLinksInputSchema)
    .output(z.array(ExternalLinkSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "read");
      return listExternalLinks(context.db, input.pageId);
    }),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{pageId}/external-links",
      tags: TAGS,
      summary: "Add an external link to a page",
    })
    .input(CreateExternalLinkInputSchema)
    .output(z.array(ExternalLinkSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "write");

      // New links land at the end of the list. Reading the current maximum and
      // then inserting is racy, but the only consequence of losing that race is
      // two links sharing a position — the list falls back to `createdAt` for a
      // stable order, and any reorder renumbers the whole page anyway.
      const existing = await listExternalLinks(context.db, input.pageId);
      const nextPosition = existing.length ? existing[existing.length - 1]!.position + 1 : 0;

      await mapUniqueViolation(
        () =>
          context.db.insert(pageExternalLink).values({
            pageId: input.pageId,
            url: input.url,
            title: input.title,
            description: input.description?.trim() || null,
            position: nextPosition,
            createdBy: context.session.user.id,
          }),
        DUPLICATE_MESSAGE,
      );
      return listExternalLinks(context.db, input.pageId);
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/external-links/{id}",
      tags: TAGS,
      summary: "Update an external link",
    })
    .input(UpdateExternalLinkInputSchema)
    .output(z.array(ExternalLinkSchema))
    .handler(async ({ input, context }) => {
      const existing = await loadExternalLink(context.db, input.id);
      const target = await loadPage(context.db, existing.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "write");

      const { id, description, ...patch } = input;
      const values = {
        ...patch,
        // `undefined` leaves the column alone; an explicit null or an emptied
        // field clears it.
        ...(description === undefined ? {} : { description: description?.trim() || null }),
      };
      // A patch naming no field at all is a valid request and a no-op — but an
      // empty `set()` is not valid SQL, so it must not reach the driver.
      if (Object.keys(values).length > 0) {
        await mapUniqueViolation(
          () => context.db.update(pageExternalLink).set(values).where(eq(pageExternalLink.id, id)),
          DUPLICATE_MESSAGE,
        );
      }
      return listExternalLinks(context.db, existing.pageId);
    }),

  move: protectedProcedure
    .route({
      method: "POST",
      path: "/external-links/{id}/move",
      tags: TAGS,
      summary: "Move an external link one slot up or down",
    })
    .input(MoveExternalLinkInputSchema)
    .output(z.array(ExternalLinkSchema))
    .handler(async ({ input, context }) => {
      const existing = await loadExternalLink(context.db, input.id);
      const target = await loadPage(context.db, existing.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "write");

      const links = await listExternalLinks(context.db, existing.pageId);
      const from = links.findIndex((link) => link.id === input.id);
      const to = input.direction === "up" ? from - 1 : from + 1;
      // Already at the edge: a no-op, not an error — the client disables the
      // button but a stale list can still send it.
      if (from < 0 || to < 0 || to >= links.length) return links;

      const reordered = [...links];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved!);

      // Renumbering the whole page keeps positions dense and lets the list
      // survive rows created before ordering existed (all defaulting to 0).
      await context.db.transaction(async (tx) => {
        for (const [index, link] of reordered.entries()) {
          if (link.position === index) continue;
          await tx
            .update(pageExternalLink)
            .set({ position: index })
            .where(eq(pageExternalLink.id, link.id));
        }
      });
      return listExternalLinks(context.db, existing.pageId);
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/external-links/{id}",
      tags: TAGS,
      summary: "Remove an external link",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.array(ExternalLinkSchema))
    .handler(async ({ input, context }) => {
      const existing = await loadExternalLink(context.db, input.id);
      const target = await loadPage(context.db, existing.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "write");
      await context.db.delete(pageExternalLink).where(eq(pageExternalLink.id, input.id));
      return listExternalLinks(context.db, existing.pageId);
    }),
};

/**
 * The page's links in display order. `createdAt` breaks ties so a list whose
 * positions collided (concurrent creates) still renders deterministically.
 */
async function listExternalLinks(db: Database, pageId: string) {
  return db.query.pageExternalLink.findMany({
    where: eq(pageExternalLink.pageId, pageId),
    orderBy: [asc(pageExternalLink.position), asc(pageExternalLink.createdAt)],
  });
}
