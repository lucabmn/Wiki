import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { activity, space, user } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg } from "../index";
import { assertSpaceRead, readableSpaceIds } from "../lib/access";
import { loadPage, loadSpace } from "../lib/loaders";
import { ActivitySchema, ListActivityInputSchema } from "../schemas/misc";

const TAGS = ["Activity"];

// The joined feed projection, shared by the scoped and org-wide queries.
const activityFeedColumns = {
  id: activity.id,
  organizationId: activity.organizationId,
  spaceId: activity.spaceId,
  pageId: activity.pageId,
  actorId: activity.actorId,
  action: activity.action,
  metadata: activity.metadata,
  createdAt: activity.createdAt,
  actor: {
    name: user.name,
  },
  space: {
    name: space.name,
    color: space.color,
  },
};

export const activityRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/activity",
      tags: TAGS,
      summary: "Recent activity in the active organization",
    })
    .input(ListActivityInputSchema)
    .output(z.array(ActivitySchema))
    .handler(async ({ input, context }) => {
      // Space- or page-scoped feed: gate on that space's visibility directly.
      if (input.spaceId || input.pageId) {
        const spaceId = input.spaceId ?? (await loadPage(context.db, input.pageId!)).spaceId;
        await assertSpaceRead(context.db, context, await loadSpace(context.db, spaceId));
        return context.db
          .select(activityFeedColumns)
          .from(activity)
          .where(
            and(
              eq(activity.spaceId, spaceId),
              input.pageId ? eq(activity.pageId, input.pageId) : undefined,
            ),
          )
          .leftJoin(user, eq(activity.actorId, user.id))
          .orderBy(desc(activity.createdAt))
          .limit(input.limit);
      }

      // Org-wide feed: only org-level events (no space) plus events in spaces the
      // caller may read — never leak activity from private spaces.
      const organizationId = requireActiveOrg(context);
      const readable = await readableSpaceIds(context.db, context, organizationId);
      const data = context.db
        .select(activityFeedColumns)
        .from(activity)
        .where(
          and(
            eq(activity.organizationId, organizationId),
            or(
              isNull(activity.spaceId),
              readable.length ? inArray(activity.spaceId, readable) : undefined,
            ),
          ),
        )
        .leftJoin(user, eq(activity.actorId, user.id))
        .leftJoin(space, eq(activity.spaceId, space.id))
        .orderBy(desc(activity.createdAt))
        .limit(input.limit);

      return data;
    }),
};
