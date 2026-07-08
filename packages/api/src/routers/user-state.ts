import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { favorite, page, pageSubscription } from "@nilovon-wiki/db/schema/index";

import { assertActiveOrgRead, protectedProcedure } from "../index";
import { loadPage, orgOfSpace } from "../lib/loaders";
import { PageSchema } from "../schemas/page";
import { PageRefInputSchema, ToggleResultSchema } from "../schemas/user-state";

const TAGS = ["Me"];

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
      const rows = await context.db
        .select({ page })
        .from(favorite)
        .innerJoin(page, eq(favorite.pageId, page.id))
        .where(eq(favorite.userId, context.session!.user.id))
        .orderBy(desc(favorite.createdAt));
      return rows.map((r) => r.page);
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
      assertActiveOrgRead(context, await orgOfSpace(context.db, target.spaceId));
      await context.db
        .insert(favorite)
        .values({ userId: context.session!.user.id, pageId: input.pageId })
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
          and(eq(favorite.userId, context.session!.user.id), eq(favorite.pageId, input.pageId)),
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
      const rows = await context.db
        .select({ page })
        .from(pageSubscription)
        .innerJoin(page, eq(pageSubscription.pageId, page.id))
        .where(eq(pageSubscription.userId, context.session!.user.id))
        .orderBy(desc(pageSubscription.createdAt));
      return rows.map((r) => r.page);
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
      assertActiveOrgRead(context, await orgOfSpace(context.db, target.spaceId));
      await context.db
        .insert(pageSubscription)
        .values({ userId: context.session!.user.id, pageId: input.pageId })
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
            eq(pageSubscription.userId, context.session!.user.id),
            eq(pageSubscription.pageId, input.pageId),
          ),
        );
      return { pageId: input.pageId, active: false };
    }),
};
