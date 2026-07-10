import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { page, pageLink } from "@nilovon-wiki/db/schema/index";

import { isOrgManager, protectedProcedure } from "../index";
import { filterReadablePages, loadSpaceRole } from "../lib/access";
import { requirePageCapability } from "../lib/authz";
import { loadPage, loadSpace } from "../lib/loaders";
import { PageSchema } from "../schemas/page";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Links"];

export const linkRouter = {
  backlinks: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{id}/backlinks",
      tags: TAGS,
      summary: "Pages that link to this page",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.array(PageSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.id);
      await requirePageCapability(context.db, context, context.headers, target, "read");
      const spaceRow = await loadSpace(context.db, target.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const spaceRole = await loadSpaceRole(context.db, context, spaceRow, manager);
      const rows = await context.db
        .select({ page })
        .from(pageLink)
        .innerJoin(page, eq(pageLink.sourcePageId, page.id))
        // A backlink is only real once the linking page is published — an
        // unpublished draft's links must not surface as incoming references.
        .where(and(eq(pageLink.targetPageId, input.id), eq(page.status, "published")))
        .orderBy(asc(page.title));
      // Linked pages live in the same space; hide any the caller can't read.
      return filterReadablePages(
        context.db,
        context,
        rows.map((r) => r.page),
        spaceRole,
      );
    }),

  outgoing: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{id}/links",
      tags: TAGS,
      summary: "Pages this page links to",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.array(PageSchema))
    .handler(async ({ input, context }) => {
      const source = await loadPage(context.db, input.id);
      await requirePageCapability(context.db, context, context.headers, source, "read");
      const spaceRow = await loadSpace(context.db, source.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const spaceRole = await loadSpaceRole(context.db, context, spaceRow, manager);
      const rows = await context.db
        .select({ page })
        .from(pageLink)
        .innerJoin(page, eq(pageLink.targetPageId, page.id))
        .where(eq(pageLink.sourcePageId, input.id))
        .orderBy(asc(page.title));
      return filterReadablePages(
        context.db,
        context,
        rows.map((r) => r.page),
        spaceRole,
      );
    }),
};
