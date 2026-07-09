import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { comment } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { requireOwnerOrPageCapability, requirePageCapability } from "../lib/authz";
import { recordActivity } from "../lib/activity";
import { loadComment, loadPage } from "../lib/loaders";
import { firstRow } from "../lib/rows";
import {
  CommentSchema,
  CreateCommentInputSchema,
  ListCommentsInputSchema,
  UpdateCommentInputSchema,
} from "../schemas/comment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Comments"];

export const commentRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/comments", tags: TAGS, summary: "List comments on a page" })
    .input(ListCommentsInputSchema)
    .output(z.array(CommentSchema))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.pageId);
      await requirePageCapability(context.db, context, context.headers, target, "read");
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
      // Commenting needs the `commenter` capability in the space.
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        target,
        "comment",
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(comment)
          .values({
            pageId: input.pageId,
            parentId: input.parentId ?? null,
            authorId: context.session.user.id,
            body: input.body,
            anchor: input.anchor ?? null,
          })
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "comment.created",
          actorId: context.session.user.id,
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
      const target = await loadPage(context.db, existing.pageId);
      // Authors edit their own; otherwise moderating (page editor+) is required.
      await requireOwnerOrPageCapability(context.db, context, context.headers, target, {
        isOwner: existing.authorId === context.session.user.id,
        capability: "write",
      });
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
      // Any participant (commenter+) may resolve or reopen a thread.
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        target,
        "comment",
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(comment)
          .set(
            input.resolved
              ? { resolvedAt: new Date(), resolvedBy: context.session.user.id }
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
            actorId: context.session.user.id,
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
      const target = await loadPage(context.db, existing.pageId);
      // Authors delete their own; moderators (page editor+) delete anyone's.
      const { organizationId } = await requireOwnerOrPageCapability(
        context.db,
        context,
        context.headers,
        target,
        { isOwner: existing.authorId === context.session.user.id, capability: "write" },
      );
      return context.db.transaction(async (tx) => {
        await tx.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, existing.id));
        await recordActivity(tx, {
          organizationId,
          action: "comment.deleted",
          actorId: context.session.user.id,
          spaceId: target.spaceId,
          pageId: target.id,
          metadata: { commentId: existing.id },
        });
        return { id: existing.id };
      });
    }),
};
