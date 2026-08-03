import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { page } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg } from "../index";
import { assertSpaceRead, readableSpaceIds } from "../lib/access";
import { filterReadablePagesAcrossSpaces } from "../lib/authz";
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

      // This must match the generated search vector in the page schema.
      const tsquery = sql`websearch_to_tsquery('german', ${input.query})`;
      const hits = await context.db
        .select({
          pageId: page.id,
          spaceId: page.spaceId,
          title: page.title,
          slug: page.slug,
          icon: page.icon,
          snippet: sql<string>`ts_headline('german', ${page.textContent}, ${tsquery}, 'MaxFragments=1, MaxWords=30, MinWords=10')`,
          rank: sql<number>`ts_rank(${page.searchVector}, ${tsquery})`,
          // Only needed to evaluate per-page ACLs below; stripped by the output
          // schema before the response leaves the server.
          id: page.id,
          visibility: page.visibility,
          createdBy: page.createdBy,
        })
        .from(page)
        .where(
          and(
            inArray(page.spaceId, spaceIds),
            isNull(page.archivedAt),
            // Only published pages are indexed for readers: an unpublished draft
            // must not surface via full-text search (its body isn't visible).
            eq(page.status, "published"),
            sql`${page.searchVector} @@ ${tsquery}`,
          ),
        )
        .orderBy(sql`ts_rank(${page.searchVector}, ${tsquery}) DESC`)
        .limit(input.limit);
      // Space read is necessary but not sufficient: a page may carry a
      // restrictive per-page `visibility` override, and a hit leaks its title
      // and a content snippet.
      return filterReadablePagesAcrossSpaces(context.db, context, context.headers, hits);
    }),
};
