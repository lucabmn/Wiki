import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { activity } from "@nilovon-wiki/db/schema/index";

import { assertActiveOrgRead, protectedProcedure, requireActiveOrg } from "../index";
import { orgOfSpace } from "../lib/loaders";
import { ActivitySchema, ListActivityInputSchema } from "../schemas/misc";

const TAGS = ["Activity"];

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
      // Scope reads to the space's org when a space filter is given, else the
      // caller's active org.
      const organizationId = input.spaceId
        ? await orgOfSpace(context.db, input.spaceId)
        : requireActiveOrg(context);
      assertActiveOrgRead(context, organizationId);
      return context.db.query.activity.findMany({
        where: and(
          eq(activity.organizationId, organizationId),
          input.spaceId ? eq(activity.spaceId, input.spaceId) : undefined,
          input.pageId ? eq(activity.pageId, input.pageId) : undefined,
        ),
        orderBy: [desc(activity.createdAt)],
        limit: input.limit,
      });
    }),
};
