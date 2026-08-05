import { ORPCError } from "@orpc/server";
import { and, count, countDistinct, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { activity, comment, member, page, space, user } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg } from "../index";
import { readableSpaceIds } from "../lib/access";
import { filterReadablePagesAcrossSpaces } from "../lib/authz";
import { pageNotTrashed } from "../lib/lifecycle";
import { firstRow } from "../lib/rows";
import {
  ListUserPagesInputSchema,
  UserPageSchema,
  UserProfileSchema,
  UserRefInputSchema,
  UserSummarySchema,
} from "../schemas/user";

const TAGS = ["Users"];

/** Splits a member row's comma-separated role list into individual names. */
function splitRoles(role: string | null): string[] {
  return (role ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The identity + membership of one user in `organizationId`, or NOT_FOUND.
 * Going through `member` is what scopes the lookup to a single tenant: without
 * it any authenticated caller could read any account by guessing an id.
 */
async function loadOrgMember(db: Database, userId: string, organizationId: string) {
  const row = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  if (!row[0]) {
    throw new ORPCError("NOT_FOUND", { message: "User not found in this organization" });
  }
  return row[0];
}

export const userRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/users",
      tags: TAGS,
      summary: "Members of the active organization",
    })
    // GET input must be an object (not z.void()) for the OpenAPI surface.
    .input(z.object({}))
    .output(z.array(UserSummarySchema))
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const rows = await context.db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: member.role,
          joinedAt: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))
        .orderBy(user.name);
      return rows.map(({ role, ...rest }) => ({ ...rest, roles: splitRoles(role) }));
    }),

  get: protectedProcedure
    .route({
      method: "GET",
      path: "/users/{userId}",
      tags: TAGS,
      summary: "One member's profile and contribution counts",
    })
    .input(UserRefInputSchema)
    .output(UserProfileSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const [profile, spaceIds] = await Promise.all([
        loadOrgMember(context.db, input.userId, organizationId),
        // Everything below is scoped to what the CALLER may read, not what the
        // profiled user may: "pages Alice wrote" means "…that you can see".
        readableSpaceIds(context.db, context, organizationId),
      ]);

      // The feed is org-scoped rather than space-scoped, so "last active" stays
      // meaningful even when the caller shares no space with this user.
      const lastActive = await context.db
        .select({ at: max(activity.createdAt) })
        .from(activity)
        .where(
          and(eq(activity.organizationId, organizationId), eq(activity.actorId, input.userId)),
        );
      const lastActiveAt = firstRow(lastActive).at;

      const { role, ...identity } = profile;
      const base = { ...identity, roles: splitRoles(role) };

      // No readable space → every contribution count is zero; skip the queries
      // (and dodge an empty `inArray`, which some drivers reject).
      if (spaceIds.length === 0) {
        return {
          ...base,
          stats: {
            pagesCreated: 0,
            pagesEdited: 0,
            comments: 0,
            spacesContributed: 0,
            lastActiveAt,
          },
        };
      }

      const inReadableSpace = and(inArray(page.spaceId, spaceIds), pageNotTrashed());
      const live = and(inReadableSpace, isNull(page.archivedAt));
      // Like the dashboard's aggregates, these counts stop at space-level read
      // access — a page carrying a stricter per-page override still counts,
      // while the lists below (`pages`) filter it out. Totals can therefore run
      // slightly ahead of the rows shown; keeping both cheap is worth it.
      const [created, edited, comments, spaces] = await Promise.all([
        context.db
          .select({ n: count() })
          .from(page)
          .where(and(live, eq(page.createdBy, input.userId))),
        context.db
          .select({ n: count() })
          .from(page)
          .where(and(live, eq(page.lastEditedBy, input.userId))),
        context.db
          .select({ n: count() })
          .from(comment)
          .innerJoin(page, eq(comment.pageId, page.id))
          .where(
            and(inReadableSpace, eq(comment.authorId, input.userId), isNull(comment.deletedAt)),
          ),
        context.db
          .select({ n: countDistinct(page.spaceId) })
          .from(page)
          .where(and(live, eq(page.createdBy, input.userId))),
      ]);

      return {
        ...base,
        stats: {
          pagesCreated: firstRow(created).n,
          pagesEdited: firstRow(edited).n,
          comments: firstRow(comments).n,
          spacesContributed: firstRow(spaces).n,
          lastActiveAt,
        },
      };
    }),

  pages: protectedProcedure
    .route({
      method: "GET",
      path: "/users/{userId}/pages",
      tags: TAGS,
      summary: "Pages a member created or last edited",
    })
    .input(ListUserPagesInputSchema)
    .output(z.array(UserPageSchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      // Establishes that the target is a member of this org before revealing
      // anything about them — same tenant boundary as `get`.
      await loadOrgMember(context.db, input.userId, organizationId);
      const spaceIds = await readableSpaceIds(context.db, context, organizationId);
      if (spaceIds.length === 0) return [];

      const byCreator = input.kind === "created";
      const rows = await context.db
        .select({
          id: page.id,
          title: page.title,
          icon: page.icon,
          status: page.status,
          spaceId: page.spaceId,
          spaceName: space.name,
          spaceColor: space.color,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
          // Carried only so the per-page ACL filter below can evaluate them.
          visibility: page.visibility,
          createdBy: page.createdBy,
        })
        .from(page)
        .innerJoin(space, eq(page.spaceId, space.id))
        .where(
          and(
            inArray(page.spaceId, spaceIds),
            isNull(page.archivedAt),
            pageNotTrashed(),
            byCreator ? eq(page.createdBy, input.userId) : eq(page.lastEditedBy, input.userId),
          ),
        )
        .orderBy(desc(byCreator ? page.createdAt : page.updatedAt))
        .limit(input.limit);

      // Space read isn't enough: a page may carry a restrictive override. The
      // filter runs after the limit, so a page hidden this way shortens the
      // result rather than pulling an extra row in — the same trade-off the
      // activity feed makes.
      const readable = await filterReadablePagesAcrossSpaces(
        context.db,
        context,
        context.headers,
        rows,
      );
      return readable.map(({ visibility: _v, createdBy: _c, ...rest }) => rest);
    }),
};
