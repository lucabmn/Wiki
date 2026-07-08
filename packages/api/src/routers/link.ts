import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { page, pageLink } from "@nilovon-wiki/db/schema/index";

import { assertActiveOrgRead, protectedProcedure } from "../index";
import { loadPage, orgOfSpace } from "../lib/loaders";
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
      assertActiveOrgRead(context, await orgOfSpace(context.db, target.spaceId));
      const rows = await context.db
        .select({ page })
        .from(pageLink)
        .innerJoin(page, eq(pageLink.sourcePageId, page.id))
        .where(eq(pageLink.targetPageId, input.id))
        .orderBy(asc(page.title));
      return rows.map((r) => r.page);
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
      assertActiveOrgRead(context, await orgOfSpace(context.db, source.spaceId));
      const rows = await context.db
        .select({ page })
        .from(pageLink)
        .innerJoin(page, eq(pageLink.targetPageId, page.id))
        .where(eq(pageLink.sourcePageId, input.id))
        .orderBy(asc(page.title));
      return rows.map((r) => r.page);
    }),
};
