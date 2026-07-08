import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { page, space } from "@nilovon-wiki/db/schema/index";

import { assertActiveOrgRead, protectedProcedure, requireActiveOrg } from "../index";
import { orgOfSpace } from "../lib/loaders";
import { SearchHitSchema, SearchInputSchema } from "../schemas/misc";

const TAGS = ["Search"];

export const searchRouter = {
  pages: protectedProcedure
    .route({
      method: "GET",
      path: "/search",
      tags: TAGS,
      summary: "Full-text search across pages",
    })
    .input(SearchInputSchema)
    .output(z.array(SearchHitSchema))
    .handler(async ({ input, context }) => {
      const organizationId = input.spaceId
        ? await orgOfSpace(context.db, input.spaceId)
        : requireActiveOrg(context);
      assertActiveOrgRead(context, organizationId);

      const tsquery = sql`websearch_to_tsquery('english', ${input.query})`;
      return context.db
        .select({
          pageId: page.id,
          spaceId: page.spaceId,
          title: page.title,
          slug: page.slug,
          icon: page.icon,
          snippet: sql<string>`ts_headline('english', ${page.textContent}, ${tsquery}, 'MaxFragments=1, MaxWords=30, MinWords=10')`,
          rank: sql<number>`ts_rank(${page.searchVector}, ${tsquery})`,
        })
        .from(page)
        .innerJoin(space, eq(page.spaceId, space.id))
        .where(
          and(
            eq(space.organizationId, organizationId),
            input.spaceId ? eq(page.spaceId, input.spaceId) : undefined,
            isNull(page.archivedAt),
            sql`${page.searchVector} @@ ${tsquery}`,
          ),
        )
        .orderBy(sql`ts_rank(${page.searchVector}, ${tsquery}) DESC`)
        .limit(input.limit);
    }),
};
