import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { courseReview, courseUpdate } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requireCourseCapability, requireCourseView } from "../lib/learn-authz";
import { findEnrollment, loadCourse } from "../lib/learn-loaders";
import { firstRow } from "../lib/rows";
import {
  CourseReviewSchema,
  CourseUpdateSchema,
  CreateCourseUpdateInputSchema,
  EditCourseUpdateInputSchema,
  UpsertCourseReviewInputSchema,
} from "../schemas/course";
import { IdSchema } from "../schemas/shared";

/**
 * The two things written *inside* a running course that are neither content nor
 * progress: announcements from its staff, and ratings from its learners. They
 * share a router because they share the course's landing page and its access
 * rules — one direction each.
 *
 * Neither produces an audit entry of its own. The feed records what happened to
 * a course, and an announcement is filed as a change to the course (there is no
 * separate action for it); a rating is learner opinion, not an administrative
 * event, so it is not recorded at all.
 */

const TAGS = ["Course announcements"];

type UpdateRow = typeof courseUpdate.$inferSelect;

/**
 * The wire shape of an announcement. Drops `textContent`, the server-side
 * plaintext projection, the same way `toCourse` drops it for courses.
 */
function toUpdate(row: UpdateRow, author: { id: string; name: string } | null) {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    content: row.content,
    publishedAt: row.publishedAt,
    notifyLearners: row.notifyLearners,
    author,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadUpdate(db: Database, id: string) {
  const row = await db.query.courseUpdate.findFirst({ where: eq(courseUpdate.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Announcement not found" });
  return row;
}

/** Resolves `publish` onto the timestamp the column actually holds. */
function publishedAtFor(row: UpdateRow, publish: boolean | undefined): Date | null {
  if (publish === undefined) return row.publishedAt;
  // Re-publishing keeps the original date: learners sort their inbox by when
  // the announcement went out, not by when a typo in it was fixed.
  return publish ? (row.publishedAt ?? new Date()) : null;
}

export const courseUpdateRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/updates",
      tags: TAGS,
      summary: "List a course's announcements",
    })
    .input(z.object({ courseId: IdSchema }))
    .output(z.array(CourseUpdateSchema))
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      const access = await requireCourseView(context.db, context, context.headers, courseRow);
      // Anyone with a staff grant sees the drafts, because that is where an
      // announcement is written before it is sent; everyone else sees only what
      // was actually published.
      const rows = await context.db.query.courseUpdate.findMany({
        where: access.role
          ? eq(courseUpdate.courseId, courseRow.id)
          : and(eq(courseUpdate.courseId, courseRow.id), isNotNull(courseUpdate.publishedAt)),
        orderBy: [desc(courseUpdate.publishedAt), desc(courseUpdate.createdAt)],
        with: { author: { columns: { id: true, name: true } } },
      });
      return rows.map((row) => toUpdate(row, row.author ?? null));
    }),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{courseId}/updates",
      tags: TAGS,
      summary: "Post an announcement to a course",
    })
    .input(CreateCourseUpdateInputSchema)
    .output(CourseUpdateSchema)
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "author");
      const actor = context.session.user;

      return context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .insert(courseUpdate)
            .values({
              courseId: courseRow.id,
              title: input.title,
              content: input.content ?? null,
              notifyLearners: input.notifyLearners,
              createdBy: actor.id,
              publishedAt: input.publish ? new Date() : null,
            })
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "course.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: {
            title: courseRow.title,
            announcement: row.title,
            published: !!row.publishedAt,
          },
        });
        return toUpdate(row, { id: actor.id, name: actor.name });
      });
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/course-updates/{id}",
      tags: TAGS,
      summary: "Edit or publish an announcement",
    })
    .input(EditCourseUpdateInputSchema)
    .output(CourseUpdateSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadUpdate(context.db, input.id);
      const courseRow = await loadCourse(context.db, existing.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "author");

      const updated = await context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .update(courseUpdate)
            .set({
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.content !== undefined ? { content: input.content ?? null } : {}),
              ...(input.notifyLearners !== undefined
                ? { notifyLearners: input.notifyLearners }
                : {}),
              publishedAt: publishedAtFor(existing, input.publish),
            })
            .where(eq(courseUpdate.id, existing.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "course.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: {
            title: courseRow.title,
            announcement: row.title,
            published: !!row.publishedAt,
          },
        });
        return row;
      });

      const author = updated.createdBy
        ? ((await context.db.query.user.findFirst({
            where: (fields, { eq: equals }) => equals(fields.id, updated.createdBy!),
            columns: { id: true, name: true },
          })) ?? null)
        : null;
      return toUpdate(updated, author);
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/course-updates/{id}",
      tags: TAGS,
      summary: "Delete an announcement",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadUpdate(context.db, input.id);
      const courseRow = await loadCourse(context.db, existing.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "author");
      return context.db.transaction(async (tx) => {
        await tx.delete(courseUpdate).where(eq(courseUpdate.id, existing.id));
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "course.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          // Denormalized: the announcement is gone by the time anyone reads
          // the log, and "an announcement was deleted" names nothing.
          metadata: { title: courseRow.title, deletedAnnouncement: existing.title },
        });
        return { id: existing.id };
      });
    }),

  // --- Reviews --------------------------------------------------------------

  listReviews: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/reviews",
      tags: TAGS,
      summary: "List a course's ratings",
    })
    .input(z.object({ courseId: IdSchema }))
    .output(z.array(CourseReviewSchema))
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      // Ratings are part of the landing page — whoever may see the course may
      // read what its learners said about it.
      await requireCourseView(context.db, context, context.headers, courseRow);
      const rows = await context.db.query.courseReview.findMany({
        where: eq(courseReview.courseId, courseRow.id),
        orderBy: [desc(courseReview.createdAt)],
        with: { user: { columns: { id: true, name: true, image: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        courseId: row.courseId,
        rating: row.rating,
        comment: row.comment,
        user: row.user ? { id: row.user.id, name: row.user.name, image: row.user.image } : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    }),

  upsertReview: protectedProcedure
    .route({
      method: "PUT",
      path: "/courses/{courseId}/reviews/mine",
      tags: TAGS,
      summary: "Write or replace the caller's rating of a course",
    })
    .input(UpsertCourseReviewInputSchema)
    .output(CourseReviewSchema)
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseView(context.db, context, context.headers, courseRow);
      const actor = context.session.user;

      // Only somebody who actually took the course may rate it. Enforced here
      // rather than by a constraint because a learner who later drops out keeps
      // the review they earned the right to write.
      const mine = await findEnrollment(context.db, courseRow.id, actor.id);
      if (!mine || (mine.status !== "active" && mine.status !== "completed")) {
        throw new ORPCError("FORBIDDEN", { message: "Enrol in this course before reviewing it" });
      }

      // One row per learner per course (`course_review_uq`): a second rating
      // replaces the first instead of stacking up.
      const row = firstRow(
        await context.db
          .insert(courseReview)
          .values({
            courseId: courseRow.id,
            userId: actor.id,
            rating: input.rating,
            comment: input.comment ?? null,
          })
          .onConflictDoUpdate({
            target: [courseReview.courseId, courseReview.userId],
            set: {
              rating: input.rating,
              comment: input.comment ?? null,
              // `$onUpdate` only fires for `.update()`, so the upsert path has
              // to move the timestamp itself.
              updatedAt: new Date(),
            },
          })
          .returning(),
      );
      return {
        id: row.id,
        courseId: row.courseId,
        rating: row.rating,
        comment: row.comment,
        user: { id: actor.id, name: actor.name, image: actor.image ?? null },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),

  deleteReview: protectedProcedure
    .route({
      method: "DELETE",
      path: "/course-reviews/{id}",
      tags: TAGS,
      summary: "Delete a rating",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await context.db.query.courseReview.findFirst({
        where: eq(courseReview.id, input.id),
      });
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Review not found" });
      const courseRow = await loadCourse(context.db, existing.courseId);
      // The author may retract their own rating; anyone else needs `manage` —
      // moderating what learners said about a course is an owner's call, not
      // something an assistant can do quietly.
      if (existing.userId !== context.session.user.id) {
        await requireCourseCapability(context.db, context, context.headers, courseRow, "manage");
      } else {
        await requireCourseView(context.db, context, context.headers, courseRow);
      }
      await context.db.delete(courseReview).where(eq(courseReview.id, existing.id));
      return { id: existing.id };
    }),
};
