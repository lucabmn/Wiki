import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { favorite, page, pageSubscription, space } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { buildSpaceReadFilter } from "../lib/access";
import { filterReadablePagesAcrossSpaces, requirePageCapability } from "../lib/authz";
import { loadPage } from "../lib/loaders";
import { PageSchema } from "../schemas/page";
import { PageRefInputSchema, ToggleResultSchema } from "../schemas/user-state";

const TAGS = ["Me"];

// The space columns needed to evaluate read access alongside each page.
const spaceAccessColumns = {
  id: space.id,
  organizationId: space.organizationId,
  visibility: space.visibility,
  createdBy: space.createdBy,
};

export const userStateRouter = {
  // --- Favorites ---------------------------------------------------------

  listFavorites: protectedProcedure
    .route({
      method: "GET",
      path: "/me/favorites",
      tags: TAGS,
      summary: "List the caller's favorite pages",
    })
    .input(z.object({}))
    .output(z.array(PageSchema))
    .handler(async ({ context }) => {
      // A favorite may point at a space the caller has since lost access to —
      // filter the result to spaces they can currently read.
      const [rows, canRead] = await Promise.all([
        context.db
          .select({ page, space: spaceAccessColumns })
          .from(favorite)
          .innerJoin(page, eq(favorite.pageId, page.id))
          .innerJoin(space, eq(page.spaceId, space.id))
          .where(eq(favorite.userId, context.session.user.id))
          .orderBy(desc(favorite.createdAt)),
        buildSpaceReadFilter(context.db, context),
      ]);
      // Space read alone is not enough: a page may carry a restrictive per-page
      // override, and this endpoint returns full content.
      return filterReadablePagesAcrossSpaces(
        context.db,
        context,
        context.headers,
        rows.filter((r) => canRead(r.space)).map((r) => r.page),
      );
    }),

  addFavorite: protectedProcedure
    .route({
      method: "PUT",
      path: "/pages/{pageId}/favorite",
      tags: TAGS,
      summary: "Favorite a page",
    })
    .input(PageRefInputSchema)
    .output(ToggleResultSchema)
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      // Page-level check: favoriting must not grant a view into a page the
      // caller can't read under a per-page override.
      await requirePageCapability(context.db, context, context.headers, target, "read");
      await context.db
        .insert(favorite)
        .values({ userId: context.session.user.id, pageId: input.pageId })
        .onConflictDoNothing();
      return { pageId: input.pageId, active: true };
    }),

  removeFavorite: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{pageId}/favorite",
      tags: TAGS,
      summary: "Remove a page from favorites",
    })
    .input(PageRefInputSchema)
    .output(ToggleResultSchema)
    .handler(async ({ input, context }) => {
      await context.db
        .delete(favorite)
        .where(
          and(eq(favorite.userId, context.session.user.id), eq(favorite.pageId, input.pageId)),
        );
      return { pageId: input.pageId, active: false };
    }),

  // --- Subscriptions -----------------------------------------------------

  listSubscriptions: protectedProcedure
    .route({
      method: "GET",
      path: "/me/subscriptions",
      tags: TAGS,
      summary: "List pages the caller is watching",
    })
    .input(z.object({}))
    .output(z.array(PageSchema))
    .handler(async ({ context }) => {
      const [rows, canRead] = await Promise.all([
        context.db
          .select({ page, space: spaceAccessColumns })
          .from(pageSubscription)
          .innerJoin(page, eq(pageSubscription.pageId, page.id))
          .innerJoin(space, eq(page.spaceId, space.id))
          .where(eq(pageSubscription.userId, context.session.user.id))
          .orderBy(desc(pageSubscription.createdAt)),
        buildSpaceReadFilter(context.db, context),
      ]);
      return filterReadablePagesAcrossSpaces(
        context.db,
        context,
        context.headers,
        rows.filter((r) => canRead(r.space)).map((r) => r.page),
      );
    }),

  subscribe: protectedProcedure
    .route({
      method: "PUT",
      path: "/pages/{pageId}/subscription",
      tags: TAGS,
      summary: "Watch a page for changes",
    })
    .input(PageRefInputSchema)
    .output(ToggleResultSchema)
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "read");
      await context.db
        .insert(pageSubscription)
        .values({ userId: context.session.user.id, pageId: input.pageId })
        .onConflictDoNothing();
      return { pageId: input.pageId, active: true };
    }),

  unsubscribe: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{pageId}/subscription",
      tags: TAGS,
      summary: "Stop watching a page",
    })
    .input(PageRefInputSchema)
    .output(ToggleResultSchema)
    .handler(async ({ input, context }) => {
      await context.db
        .delete(pageSubscription)
        .where(
          and(
            eq(pageSubscription.userId, context.session.user.id),
            eq(pageSubscription.pageId, input.pageId),
          ),
        );
      return { pageId: input.pageId, active: false };
    }),
};
