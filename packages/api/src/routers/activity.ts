import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { activity, page, space, user } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure, requireActiveOrg } from "../index";
import { assertSpaceRead, readableSpaceIds } from "../lib/access";
import { filterReadablePagesAcrossSpaces, requirePageCapability } from "../lib/authz";
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
  impersonatedBy: activity.impersonatedBy,
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

/**
 * Drops feed rows that reference a page the caller can't read under a per-page
 * `visibility` override — activity metadata carries page titles. Space-level
 * read access is already established for every row's space by the callers.
 */
async function dropRestrictedPageRows<T extends { pageId: string | null; action: string }>(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  rows: T[],
): Promise<T[]> {
  const pageIds = [...new Set(rows.flatMap((r) => (r.pageId ? [r.pageId] : [])))];
  const pages = pageIds.length
    ? await db
        .select({
          id: page.id,
          spaceId: page.spaceId,
          visibility: page.visibility,
          createdBy: page.createdBy,
        })
        .from(page)
        .where(inArray(page.id, pageIds))
    : [];
  const readable = new Set(
    (await filterReadablePagesAcrossSpaces(db, context, headers, pages)).map((p) => p.id),
  );
  // Once a page is hard-deleted its FK becomes null, so its former ACL can no
  // longer be checked. Keep only definitely space-scoped events in that case;
  // suppressing ambiguous comment/attachment events is safer than exposing
  // metadata that used to belong to a restricted page.
  return rows.filter((r) => (r.pageId ? readable.has(r.pageId) : r.action.startsWith("space.")));
}

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
      // Space- or page-scoped feed: gate on the space, and for a page-scoped
      // request on the page itself (per-page overrides narrow space access).
      if (input.spaceId || input.pageId) {
        let spaceId: string;
        if (input.pageId) {
          const target = await loadPage(context.db, input.pageId);
          await requirePageCapability(context.db, context, context.headers, target, "read");
          spaceId = target.spaceId;
        } else {
          spaceId = input.spaceId!;
          await assertSpaceRead(context.db, context, await loadSpace(context.db, spaceId));
        }
        const rows = await context.db
          .select(activityFeedColumns)
          .from(activity)
          .where(
            and(
              eq(activity.spaceId, spaceId),
              input.pageId ? eq(activity.pageId, input.pageId) : undefined,
              input.actorId ? eq(activity.actorId, input.actorId) : undefined,
            ),
          )
          .leftJoin(user, eq(activity.actorId, user.id))
          .leftJoin(space, eq(activity.spaceId, space.id))
          .orderBy(desc(activity.createdAt))
          .limit(input.limit);
        return input.pageId
          ? rows
          : dropRestrictedPageRows(context.db, context, context.headers, rows);
      }

      // Org-wide feed: only org-level events (no space) plus events in spaces the
      // caller may read — never leak activity from private spaces.
      const organizationId = requireActiveOrg(context);
      const readable = await readableSpaceIds(context.db, context, organizationId);
      const data = await context.db
        .select(activityFeedColumns)
        .from(activity)
        .where(
          and(
            eq(activity.organizationId, organizationId),
            input.actorId ? eq(activity.actorId, input.actorId) : undefined,
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

      return dropRestrictedPageRows(context.db, context, context.headers, data);
    }),
};
