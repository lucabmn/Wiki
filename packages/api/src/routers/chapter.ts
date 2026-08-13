import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { chapter } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { generateKeyBetween } from "../lib/fractional";
import { requireChapterCapability, requireCourseCapabilityById } from "../lib/learn-authz";
import { loadChapter } from "../lib/learn-loaders";
import { firstRow } from "../lib/rows";
import {
  ChapterSchema,
  CreateChapterInputSchema,
  MoveChapterInputSchema,
  UpdateChapterInputSchema,
} from "../schemas/lesson";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Chapters"];

/**
 * The fractional key that places a new or moved sibling directly after
 * `afterId` — or at the front when it is null.
 *
 * Reordering therefore writes exactly one row, whatever the chapter's position
 * in a course of any size. Same scheme as the page tree; see `lib/fractional`.
 */
async function positionAfter(
  db: Parameters<typeof loadChapter>[0],
  courseId: string,
  afterId: string | null | undefined,
  excludeId?: string,
): Promise<string> {
  const siblings = (
    await db.query.chapter.findMany({
      where: eq(chapter.courseId, courseId),
      columns: { id: true, position: true },
      orderBy: [asc(chapter.position)],
    })
  ).filter((row) => row.id !== excludeId);

  if (!afterId) {
    // To the front: between nothing and the current first.
    return generateKeyBetween(null, siblings[0]?.position ?? null);
  }
  const index = siblings.findIndex((row) => row.id === afterId);
  if (index === -1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The chapter to insert after is not in this course",
    });
  }
  return generateKeyBetween(siblings[index]!.position, siblings[index + 1]?.position ?? null);
}

export const chapterRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/chapters",
      tags: TAGS,
      summary: "List a course's chapters",
    })
    .input(z.object({ courseId: IdSchema }))
    .output(z.array(ChapterSchema))
    .handler(async ({ input, context }) => {
      // "view" rather than "learn": the flat chapter list is an authoring view.
      // What a learner sees is the outline, which resolves drip and sequence.
      await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        input.courseId,
        "view",
      );
      return context.db.query.chapter.findMany({
        where: eq(chapter.courseId, input.courseId),
        orderBy: [asc(chapter.position)],
      });
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/chapters", tags: TAGS, summary: "Create a chapter" })
    .input(CreateChapterInputSchema)
    .output(ChapterSchema)
    .handler(async ({ input, context }) => {
      const course = await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        input.courseId,
        "author",
      );
      const position = await positionAfter(context.db, course.id, input.afterChapterId);
      return context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .insert(chapter)
            .values({
              courseId: course.id,
              title: input.title,
              description: input.description ?? null,
              position,
            })
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "chapter.created",
          ...activityActor(context),
          courseId: course.id,
          metadata: { chapterId: row.id, title: row.title },
        });
        return row;
      });
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/chapters/{id}", tags: TAGS, summary: "Update a chapter" })
    .input(UpdateChapterInputSchema)
    .output(ChapterSchema)
    .handler(async ({ input, context }) => {
      const { course } = await requireChapterCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );
      return context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .update(chapter)
            .set({
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.description !== undefined
                ? { description: input.description ?? null }
                : {}),
              ...(input.availableFrom !== undefined
                ? { availableFrom: input.availableFrom ?? null }
                : {}),
              ...(input.dripDelayDays !== undefined
                ? { dripDelayDays: input.dripDelayDays ?? null }
                : {}),
              ...(input.published !== undefined
                ? { publishedAt: input.published ? new Date() : null }
                : {}),
            })
            .where(eq(chapter.id, input.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "chapter.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { chapterId: row.id, title: row.title },
        });
        return row;
      });
    }),

  move: protectedProcedure
    .route({
      method: "POST",
      path: "/chapters/{id}/move",
      tags: TAGS,
      summary: "Reorder a chapter within its course",
    })
    .input(MoveChapterInputSchema)
    .output(ChapterSchema)
    .handler(async ({ input, context }) => {
      const { chapter: row, course } = await requireChapterCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );
      const position = await positionAfter(context.db, row.courseId, input.afterChapterId, row.id);
      return context.db.transaction(async (tx) => {
        const moved = firstRow(
          await tx.update(chapter).set({ position }).where(eq(chapter.id, row.id)).returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "chapter.moved",
          ...activityActor(context),
          courseId: course.id,
          metadata: { chapterId: row.id, title: row.title },
        });
        return moved;
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/chapters/{id}",
      tags: TAGS,
      summary: "Delete a chapter and every lesson in it",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const { chapter: row, course } = await requireChapterCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );
      return context.db.transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "chapter.deleted",
          ...activityActor(context),
          courseId: course.id,
          // Denormalized: the row is gone by the time anyone reads the log.
          metadata: { chapterId: row.id, title: row.title },
        });
        await tx.delete(chapter).where(eq(chapter.id, row.id));
        return { id: row.id };
      });
    }),
};
