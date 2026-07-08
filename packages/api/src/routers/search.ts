import { and, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { page } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg } from "../index";
import { assertSpaceRead, readableSpaceIds } from "../lib/access";
import { loadSpace } from "../lib/loaders";
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
      // Restrict the corpus to spaces the caller may read, so search can't leak
      // titles/snippets from private spaces.
      let spaceIds: string[];
      if (input.spaceId) {
        await assertSpaceRead(context.db, context, await loadSpace(context.db, input.spaceId));
        spaceIds = [input.spaceId];
      } else {
        spaceIds = await readableSpaceIds(context.db, context, requireActiveOrg(context));
      }
      if (spaceIds.length === 0) {
        return [];
      }

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
        .where(
          and(
            inArray(page.spaceId, spaceIds),
            isNull(page.archivedAt),
            sql`${page.searchVector} @@ ${tsquery}`,
          ),
        )
        .orderBy(sql`ts_rank(${page.searchVector}, ${tsquery}) DESC`)
        .limit(input.limit);
    }),
};
