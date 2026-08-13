import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { chapter, lesson, lessonProgress } from "@nilovon-wiki/db/schema/index";

import type { Database } from "@nilovon-wiki/db";
import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { courseAssetUrl } from "../lib/course-cards";
import { resolveOutline } from "../lib/course-outline";
import { generateKeyBetween } from "../lib/fractional";
import {
  requireCourseCapabilityById,
  requireCourseView,
  requireLessonCapability,
  requireLessonRead,
} from "../lib/learn-authz";
import { findEnrollment, loadChapter, loadCourse } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CourseOutlineSchema,
  CreateLessonInputSchema,
  LessonSchema,
  MoveLessonInputSchema,
  UpdateLessonInputSchema,
} from "../schemas/lesson";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Lessons"];

type LessonRow = typeof lesson.$inferSelect;

/**
 * The wire shape of a lesson. Drops the server-only columns — `textContent` is
 * a search projection and `yjsState` is a CRDT snapshot, neither of which any
 * client should read — and resolves the asset into a URL.
 */
function toLesson(row: LessonRow) {
  return {
    id: row.id,
    courseId: row.courseId,
    chapterId: row.chapterId,
    kind: row.kind,
    title: row.title,
    slug: row.slug,
    position: row.position,
    content: row.content,
    assetId: row.assetId,
    assetUrl: courseAssetUrl(row.assetId),
    embedUrl: row.embedUrl,
    durationSeconds: row.durationSeconds,
    isRequired: row.isRequired,
    autoCompleteAtPercent: row.autoCompleteAtPercent,
    publishedAt: row.publishedAt,
    createdBy: row.createdBy,
    lastEditedBy: row.lastEditedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Fractional key placing a lesson directly after `afterId` within a chapter. */
async function positionAfter(
  db: Database,
  chapterId: string,
  afterId: string | null | undefined,
  excludeId?: string,
): Promise<string> {
  const siblings = (
    await db.query.lesson.findMany({
      where: eq(lesson.chapterId, chapterId),
      columns: { id: true, position: true },
      orderBy: [asc(lesson.position)],
    })
  ).filter((row) => row.id !== excludeId);

  if (!afterId) return generateKeyBetween(null, siblings[0]?.position ?? null);
  const index = siblings.findIndex((row) => row.id === afterId);
  if (index === -1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The lesson to insert after is not in this chapter",
    });
  }
  return generateKeyBetween(siblings[index]!.position, siblings[index + 1]?.position ?? null);
}

export const lessonRouter = {
  outline: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/outline",
      tags: TAGS,
      summary: "The course outline with the caller's progress and lock state",
    })
    .input(z.object({ courseId: IdSchema }))
    .output(CourseOutlineSchema)
    .handler(async ({ input, context }) => {
      const course = await loadCourse(context.db, input.courseId);
      // `view`, not `learn`: the landing page shows the outline before anyone
      // enrols. What enrolment changes is whether a lesson *opens*, which the
      // resolver below answers per row.
      const access = await requireCourseView(context.db, context, context.headers, course);
      const userId = context.session.user.id;
      const isStaff = access.role !== null;

      const enrollment = await findEnrollment(context.db, course.id, userId);
      const [chapters, lessons, progress] = await Promise.all([
        context.db.query.chapter.findMany({
          where: eq(chapter.courseId, course.id),
          orderBy: [asc(chapter.position)],
        }),
        context.db.query.lesson.findMany({
          where: eq(lesson.courseId, course.id),
          orderBy: [asc(lesson.position)],
        }),
        enrollment
          ? context.db.query.lessonProgress.findMany({
              where: eq(lessonProgress.enrollmentId, enrollment.id),
            })
          : Promise.resolve([]),
      ]);

      return resolveOutline(course.id, {
        chapters,
        lessons,
        progress: progress.map((row) => ({
          lessonId: row.lessonId,
          status: row.status,
          furthestPercent: row.furthestPercent,
          positionSeconds: row.positionSeconds,
        })),
        isStaff,
        canLearn: access.canLearn,
        sequential: course.sequential,
        enrolledAt: enrollment?.enrolledAt ?? null,
        now: new Date(),
      });
    }),

  get: protectedProcedure
    .route({ method: "GET", path: "/lessons/{id}", tags: TAGS, summary: "Open a lesson" })
    .input(z.object({ id: IdSchema }))
    .output(LessonSchema)
    .handler(async ({ input, context }) => {
      const { lesson: row } = await requireLessonRead(
        context.db,
        context,
        context.headers,
        input.id,
      );
      return toLesson(row);
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/lessons", tags: TAGS, summary: "Create a lesson" })
    .input(CreateLessonInputSchema)
    .output(LessonSchema)
    .handler(async ({ input, context }) => {
      const chapterRow = await loadChapter(context.db, input.chapterId);
      const course = await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        chapterRow.courseId,
        "author",
      );
      const [position, slug] = await Promise.all([
        positionAfter(context.db, chapterRow.id, input.afterLessonId),
        uniqueSlug(
          slugify(input.title),
          async (candidate) =>
            !!(await context.db.query.lesson.findFirst({
              where: and(eq(lesson.courseId, course.id), eq(lesson.slug, candidate)),
            })),
        ),
      ]);

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const row = firstRow(
              await tx
                .insert(lesson)
                .values({
                  courseId: course.id,
                  chapterId: chapterRow.id,
                  kind: input.kind,
                  title: input.title,
                  slug,
                  position,
                  createdBy: context.session.user.id,
                  lastEditedBy: context.session.user.id,
                })
                .returning(),
            );
            await recordActivity(tx, {
              organizationId: course.organizationId,
              action: "lesson.created",
              ...activityActor(context),
              courseId: course.id,
              metadata: { lessonId: row.id, title: row.title, kind: row.kind },
            });
            return toLesson(row);
          }),
        "A lesson with this slug already exists in the course",
      );
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/lessons/{id}", tags: TAGS, summary: "Update a lesson" })
    .input(UpdateLessonInputSchema)
    .output(LessonSchema)
    .handler(async ({ input, context }) => {
      const { lesson: row, course } = await requireLessonCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );

      // The kind decides which payload column is meaningful. Rejecting the
      // mismatch here is what keeps "a video lesson with no video" out of the
      // database instead of out of the player at runtime.
      if (input.embedUrl !== undefined && input.embedUrl && row.kind !== "embed") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only an embed lesson carries an embed URL",
        });
      }
      if (
        input.assetId !== undefined &&
        input.assetId &&
        !["video", "document"].includes(row.kind)
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only a video or document lesson carries an uploaded file",
        });
      }

      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(lesson)
            .set({
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.content !== undefined ? { content: input.content ?? null } : {}),
              // Only overwrite the search projection when the editor sends one;
              // a title-only save must not blank it.
              ...(input.textContent !== undefined ? { textContent: input.textContent } : {}),
              ...(input.assetId !== undefined ? { assetId: input.assetId ?? null } : {}),
              ...(input.embedUrl !== undefined ? { embedUrl: input.embedUrl ?? null } : {}),
              ...(input.durationSeconds !== undefined
                ? { durationSeconds: input.durationSeconds ?? null }
                : {}),
              ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
              ...(input.autoCompleteAtPercent !== undefined
                ? { autoCompleteAtPercent: input.autoCompleteAtPercent ?? null }
                : {}),
              lastEditedBy: context.session.user.id,
            })
            .where(eq(lesson.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "lesson.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { lessonId: row.id, title: updated.title },
        });
        return toLesson(updated);
      });
    }),

  publish: protectedProcedure
    .route({
      method: "POST",
      path: "/lessons/{id}/publish",
      tags: TAGS,
      summary: "Publish or unpublish a lesson",
    })
    .input(z.object({ id: IdSchema, published: z.boolean().default(true) }))
    .output(LessonSchema)
    .handler(async ({ input, context }) => {
      const { lesson: row, course } = await requireLessonCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );
      if (input.published) assertPublishable(row);

      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(lesson)
            .set({ publishedAt: input.published ? (row.publishedAt ?? new Date()) : null })
            .where(eq(lesson.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: input.published ? "lesson.published" : "lesson.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { lessonId: row.id, title: updated.title },
        });
        return toLesson(updated);
      });
    }),

  move: protectedProcedure
    .route({
      method: "POST",
      path: "/lessons/{id}/move",
      tags: TAGS,
      summary: "Move a lesson within or between chapters",
    })
    .input(MoveLessonInputSchema)
    .output(LessonSchema)
    .handler(async ({ input, context }) => {
      const { lesson: row, course } = await requireLessonCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );
      const targetChapterId = input.chapterId ?? row.chapterId;
      if (targetChapterId !== row.chapterId) {
        const target = await loadChapter(context.db, targetChapterId);
        // Moving between courses would carry a lesson out from under its
        // access rules; chapters are the only boundary a move may cross.
        if (target.courseId !== row.courseId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "A lesson can only move within its own course",
          });
        }
      }
      const position = await positionAfter(
        context.db,
        targetChapterId,
        input.afterLessonId,
        row.id,
      );

      return context.db.transaction(async (tx) => {
        const moved = firstRow(
          await tx
            .update(lesson)
            .set({ chapterId: targetChapterId, position })
            .where(eq(lesson.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "lesson.moved",
          ...activityActor(context),
          courseId: course.id,
          metadata: { lessonId: row.id, title: moved.title, chapterId: targetChapterId },
        });
        return toLesson(moved);
      });
    }),

  delete: protectedProcedure
    .route({ method: "DELETE", path: "/lessons/{id}", tags: TAGS, summary: "Delete a lesson" })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const { lesson: row, course } = await requireLessonCapability(
        context.db,
        context,
        context.headers,
        input.id,
        "author",
      );
      return context.db.transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "lesson.deleted",
          ...activityActor(context),
          courseId: course.id,
          metadata: { lessonId: row.id, title: row.title },
        });
        await tx.delete(lesson).where(eq(lesson.id, row.id));
        return { id: row.id };
      });
    }),
};

/**
 * Refuses to publish a lesson whose payload does not match its kind.
 *
 * The check belongs at publication rather than at every save: an author must be
 * able to create the shell of a video lesson before the upload finishes, but a
 * learner must never open one that plays nothing.
 */
function assertPublishable(row: LessonRow): void {
  const missing =
    (row.kind === "video" || row.kind === "document") && !row.assetId
      ? "a file"
      : row.kind === "embed" && !row.embedUrl
        ? "an embed URL"
        : row.kind === "dynamic" && !row.content
          ? "some content"
          : null;
  if (missing) {
    throw new ORPCError("BAD_REQUEST", {
      message: `This lesson still needs ${missing} before it can be published`,
    });
  }
}
