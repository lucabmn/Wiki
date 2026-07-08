import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { comment } from "@nilovon-wiki/db/schema/index";

import {
  assertActiveOrgRead,
  assertOrgPermission,
  hasOrgPermission,
  protectedProcedure,
} from "../index";
import { recordActivity } from "../lib/activity";
import { loadComment, loadPage, orgOfSpace } from "../lib/loaders";
import { firstRow } from "../lib/rows";
import {
  CommentSchema,
  CreateCommentInputSchema,
  ListCommentsInputSchema,
  UpdateCommentInputSchema,
} from "../schemas/comment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Comments"];

/** Resolves the org that owns the space a comment's page lives in. */
async function orgOfComment(db: Database, pageId: string) {
  const page = await loadPage(db, pageId);
  return orgOfSpace(db, page.spaceId);
}

export const commentRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/comments", tags: TAGS, summary: "List comments on a page" })
    .input(ListCommentsInputSchema)
    .output(z.array(CommentSchema))
    .handler(async ({ input, context }) => {
      assertActiveOrgRead(context, await orgOfComment(context.db, input.pageId));
      return context.db.query.comment.findMany({
        where: and(
          eq(comment.pageId, input.pageId),
          isNull(comment.deletedAt),
          input.includeResolved ? undefined : isNull(comment.resolvedAt),
        ),
        orderBy: [asc(comment.createdAt)],
      });
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/comments", tags: TAGS, summary: "Add a comment to a page" })
    .input(CreateCommentInputSchema)
    .output(CommentSchema)
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      const organizationId = await orgOfSpace(context.db, target.spaceId);
      await assertOrgPermission(context.headers, { comment: ["create"] }, organizationId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(comment)
          .values({
            pageId: input.pageId,
            parentId: input.parentId ?? null,
            authorId: context.session?.user.id,
            body: input.body,
            anchor: input.anchor ?? null,
          })
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "comment.created",
          actorId: context.session?.user.id,
          spaceId: target.spaceId,
          pageId: target.id,
          metadata: { commentId: row.id },
        });
        return row;
      });
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/comments/{id}", tags: TAGS, summary: "Edit a comment" })
    .input(UpdateCommentInputSchema)
    .output(CommentSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadComment(context.db, input.id);
      // Authors may edit their own comment; otherwise `comment:moderate` is
      // required (comments have no separate edit-others permission).
      const organizationId = await orgOfComment(context.db, existing.pageId);
      if (existing.authorId !== context.session?.user.id) {
        await assertOrgPermission(context.headers, { comment: ["moderate"] }, organizationId);
      } else {
        await assertOrgPermission(context.headers, { comment: ["update"] }, organizationId);
      }
      const rows = await context.db
        .update(comment)
        .set({ body: input.body })
        .where(eq(comment.id, existing.id))
        .returning();
      return firstRow(rows);
    }),

  resolve: protectedProcedure
    .route({
      method: "POST",
      path: "/comments/{id}/resolve",
      tags: TAGS,
      summary: "Resolve or reopen a comment thread",
    })
    .input(z.object({ id: IdSchema, resolved: z.boolean().default(true) }))
    .output(CommentSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadComment(context.db, input.id);
      const target = await loadPage(context.db, existing.pageId);
      const organizationId = await orgOfSpace(context.db, target.spaceId);
      await assertOrgPermission(context.headers, { comment: ["update"] }, organizationId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(comment)
          .set(
            input.resolved
              ? { resolvedAt: new Date(), resolvedBy: context.session?.user.id }
              : { resolvedAt: null, resolvedBy: null },
          )
          .where(eq(comment.id, existing.id))
          .returning();
        const row = firstRow(rows);
        // Only resolution has a feed action; reopening has no matching enum.
        if (input.resolved) {
          await recordActivity(tx, {
            organizationId,
            action: "comment.resolved",
            actorId: context.session?.user.id,
            spaceId: target.spaceId,
            pageId: target.id,
            metadata: { commentId: row.id },
          });
        }
        return row;
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/comments/{id}",
      tags: TAGS,
      summary: "Soft-delete a comment",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadComment(context.db, input.id);
      const organizationId = await orgOfComment(context.db, existing.pageId);
      const isAuthor = existing.authorId === context.session?.user.id;
      // Authors delete their own; moderators delete anyone's.
      if (!isAuthor) {
        await assertOrgPermission(context.headers, { comment: ["moderate"] }, organizationId);
      } else if (
        !(await hasOrgPermission(context.headers, { comment: ["delete"] }, organizationId))
      ) {
        throw new ORPCError("FORBIDDEN");
      }
      await context.db
        .update(comment)
        .set({ deletedAt: new Date() })
        .where(eq(comment.id, existing.id));
      return { id: existing.id };
    }),
};
