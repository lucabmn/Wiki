import { and, count, countDistinct, eq, gte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { activity, comment, page } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg } from "../index";
import { readableSpaceIds } from "../lib/access";
import { pageNotTrashed } from "../lib/lifecycle";
import { firstRow } from "../lib/rows";
import { DashboardOverviewSchema } from "../schemas/misc";

const TAGS = ["Dashboard"];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const dashboardRouter = {
  overview: protectedProcedure
    .route({
      method: "GET",
      path: "/dashboard/overview",
      tags: TAGS,
      summary: "Aggregate counts for the active organization's dashboard",
    })
    // GET input must be an object (not z.void()) for the OpenAPI surface.
    .input(z.object({}))
    .output(DashboardOverviewSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const spaceIds = await readableSpaceIds(context.db, context, organizationId);

      // No readable space → every count is zero; skip the queries (and dodge an
      // empty `inArray`, which some drivers reject).
      if (spaceIds.length === 0) {
        return {
          pageCount: 0,
          pagesCreatedThisWeek: 0,
          openComments: 0,
          commentsResolvedThisWeek: 0,
          activeMembersThisWeek: 0,
        };
      }

      const weekAgo = new Date(Date.now() - WEEK_MS);
      // `spaceIds` already excludes trashed spaces; this drops individually
      // trashed pages, which would otherwise still be counted.
      const inReadableSpace = and(inArray(page.spaceId, spaceIds), pageNotTrashed());
      // Comment counts join through page so they inherit the same space scope.
      const commentInReadableSpace = () =>
        context.db
          .select({ n: count() })
          .from(comment)
          .innerJoin(page, eq(comment.pageId, page.id));

      const [pageCount, pagesCreatedThisWeek, openComments, commentsResolvedThisWeek, members] =
        await Promise.all([
          context.db
            .select({ n: count() })
            .from(page)
            .where(and(inReadableSpace, isNull(page.archivedAt))),
          context.db
            .select({ n: count() })
            .from(page)
            .where(and(inReadableSpace, isNull(page.archivedAt), gte(page.createdAt, weekAgo))),
          commentInReadableSpace().where(
            and(inReadableSpace, isNull(comment.deletedAt), isNull(comment.resolvedAt)),
          ),
          commentInReadableSpace().where(
            and(inReadableSpace, isNull(comment.deletedAt), gte(comment.resolvedAt, weekAgo)),
          ),
          context.db
            .select({ n: countDistinct(activity.actorId) })
            .from(activity)
            .where(
              and(eq(activity.organizationId, organizationId), gte(activity.createdAt, weekAgo)),
            ),
        ]);

      return {
        pageCount: firstRow(pageCount).n,
        pagesCreatedThisWeek: firstRow(pagesCreatedThisWeek).n,
        openComments: firstRow(openComments).n,
        commentsResolvedThisWeek: firstRow(commentsResolvedThisWeek).n,
        activeMembersThisWeek: firstRow(members).n,
      };
    }),
};
