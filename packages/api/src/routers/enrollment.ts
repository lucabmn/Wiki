import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { certificate, enrollment, lessonProgress, user } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { issueCertificate } from "../lib/certificates";
import { hasCourseEntitlement, resolveEnrollability } from "../lib/course-access";
import { seatsLeft } from "../lib/course-cards";
import {
  completedLessonCount,
  publishedLessonIds,
  recomputeEnrollmentProgress,
  seedChapterReleases,
} from "../lib/course-progress";
import {
  requireCourseCapabilityById,
  requireCourseView,
  requireLessonRead,
} from "../lib/learn-authz";
import { findEnrollment, loadCourse, loadEnrollment } from "../lib/learn-loaders";
import { firstRow } from "../lib/rows";
import {
  CompleteLessonInputSchema,
  DecideEnrollmentInputSchema,
  EnrollInputSchema,
  EnrollmentSchema,
  InviteLearnersInputSchema,
  ListRosterInputSchema,
  ProgressResultSchema,
  RemoveEnrollmentInputSchema,
  RosterEntrySchema,
  TrackProgressInputSchema,
} from "../schemas/enrollment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Enrollments"];

export const enrollmentRouter = {
  listMine: protectedProcedure
    .route({
      method: "GET",
      path: "/enrollments/mine",
      tags: TAGS,
      summary: "The caller's own enrolments",
    })
    .input(z.object({}))
    .output(z.array(EnrollmentSchema))
    .handler(async ({ context }) =>
      context.db.query.enrollment.findMany({
        where: eq(enrollment.userId, context.session.user.id),
        orderBy: [desc(enrollment.lastActivityAt), desc(enrollment.enrolledAt)],
      }),
    ),

  roster: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/enrollments",
      tags: TAGS,
      summary: "The learners enrolled in a course",
    })
    .input(ListRosterInputSchema)
    .output(z.array(RosterEntrySchema))
    .handler(async ({ input, context }) => {
      // The roster names individuals, so it needs the grant that already implies
      // seeing their work — merely being able to view the course is not enough.
      await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        input.courseId,
        "grade",
      );
      const rows = await context.db.query.enrollment.findMany({
        where: and(
          eq(enrollment.courseId, input.courseId),
          input.status ? eq(enrollment.status, input.status) : undefined,
        ),
        with: { user: { columns: { id: true, name: true, email: true, image: true } } },
        orderBy: [desc(enrollment.enrolledAt)],
        limit: input.limit,
        offset: input.offset,
      });

      const lessonIds = await publishedLessonIds(context.db, input.courseId);
      return Promise.all(
        rows.map(async (row) => ({
          ...row,
          user: row.user ?? null,
          completedLessons: await completedLessonCount(context.db, row.id, lessonIds),
          totalLessons: lessonIds.length,
        })),
      );
    }),

  enroll: protectedProcedure
    .route({
      method: "POST",
      path: "/enrollments",
      tags: TAGS,
      summary: "Enrol the caller in a course",
    })
    .input(EnrollInputSchema)
    .output(EnrollmentSchema)
    .handler(async ({ input, context }) => {
      const course = await loadCourse(context.db, input.courseId);
      const access = await requireCourseView(context.db, context, context.headers, course);
      const userId = context.session.user.id;
      const existing = await findEnrollment(context.db, course.id, userId);

      const verdict = resolveEnrollability({
        access,
        status: course.status,
        policy: course.enrollmentPolicy,
        enrollment: existing?.status ?? null,
        seatsLeft: await seatsLeft(context.db, course),
        closed: course.enrollmentClosesAt
          ? course.enrollmentClosesAt.getTime() <= Date.now()
          : false,
        hasEntitlement:
          course.enrollmentPolicy === "paid"
            ? await hasCourseEntitlement(context.db, userId, course.id)
            : false,
      });
      if (!verdict.allowed) {
        // The reason travels with the refusal so the UI can explain it rather
        // than showing a bare 403.
        throw new ORPCError("FORBIDDEN", { message: verdict.reason });
      }

      // `request` produces a row an author still has to approve; everything else
      // is active immediately.
      const status = verdict.reason === "approval_required" ? "pending" : "active";
      const source = course.enrollmentPolicy === "paid" ? "purchase" : "self";

      return context.db.transaction(async (tx) => {
        const enrolledAt = new Date();
        const row = existing
          ? firstRow(
              await tx
                .update(enrollment)
                .set({ status, source, enrolledAt, droppedAt: null })
                .where(eq(enrollment.id, existing.id))
                .returning(),
            )
          : firstRow(
              await tx
                .insert(enrollment)
                .values({ courseId: course.id, userId, status, source, enrolledAt })
                .returning(),
            );
        await seedChapterReleases(tx, row.id, course.id, enrolledAt);
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "enrollment.created",
          ...activityActor(context),
          courseId: course.id,
          metadata: { enrollmentId: row.id, status },
        });
        return row;
      });
    }),

  leave: protectedProcedure
    .route({
      method: "POST",
      path: "/enrollments/{id}/leave",
      tags: TAGS,
      summary: "Leave a course, keeping the progress for a later return",
    })
    .input(z.object({ id: IdSchema }))
    .output(EnrollmentSchema)
    .handler(async ({ input, context }) => {
      const row = await loadEnrollment(context.db, input.id);
      if (row.userId !== context.session.user.id) throw new ORPCError("FORBIDDEN");
      const course = await loadCourse(context.db, row.courseId);
      return context.db.transaction(async (tx) => {
        // Dropped, not deleted: the progress and any submissions stay, so
        // rejoining continues rather than restarts.
        const updated = firstRow(
          await tx
            .update(enrollment)
            .set({ status: "dropped", droppedAt: new Date() })
            .where(eq(enrollment.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "enrollment.dropped",
          ...activityActor(context),
          courseId: course.id,
          metadata: { enrollmentId: row.id },
        });
        return updated;
      });
    }),

  invite: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{courseId}/enrollments/invite",
      tags: TAGS,
      summary: "Add learners to a course directly",
    })
    .input(InviteLearnersInputSchema)
    .output(z.array(EnrollmentSchema))
    .handler(async ({ input, context }) => {
      const course = await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        input.courseId,
        "manage",
      );
      const invitedBy = context.session.user.id;
      const enrolledAt = new Date();

      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(enrollment)
          .values(
            input.userIds.map((userId) => ({
              courseId: course.id,
              userId,
              status: "active" as const,
              source: "invite" as const,
              invitedBy,
              enrolledAt,
            })),
          )
          // Someone already in the course is not an error: re-inviting them
          // reactivates the existing row rather than failing the whole batch.
          .onConflictDoUpdate({
            target: [enrollment.courseId, enrollment.userId],
            set: { status: "active", droppedAt: null },
          })
          .returning();

        for (const row of rows) {
          await seedChapterReleases(tx, row.id, course.id, row.enrolledAt);
        }
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "enrollment.created",
          ...activityActor(context),
          courseId: course.id,
          metadata: { invited: rows.length },
        });
        return rows;
      });
    }),

  decide: protectedProcedure
    .route({
      method: "POST",
      path: "/enrollments/{id}/decide",
      tags: TAGS,
      summary: "Approve or refuse a pending enrolment request",
    })
    .input(DecideEnrollmentInputSchema)
    .output(EnrollmentSchema)
    .handler(async ({ input, context }) => {
      const row = await loadEnrollment(context.db, input.id);
      const course = await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        row.courseId,
        "manage",
      );
      if (row.status !== "pending") {
        throw new ORPCError("BAD_REQUEST", {
          message: "This enrolment is not awaiting a decision",
        });
      }
      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(enrollment)
            .set(
              input.approve
                ? { status: "active", enrolledAt: new Date() }
                : { status: "dropped", droppedAt: new Date() },
            )
            .where(eq(enrollment.id, row.id))
            .returning(),
        );
        if (input.approve) {
          await seedChapterReleases(tx, row.id, course.id, updated.enrolledAt);
        }
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: input.approve ? "enrollment.approved" : "enrollment.dropped",
          ...activityActor(context),
          courseId: course.id,
          metadata: { enrollmentId: row.id },
        });
        return updated;
      });
    }),

  remove: protectedProcedure
    .route({
      method: "DELETE",
      path: "/enrollments/{id}",
      tags: TAGS,
      summary: "Remove a learner from a course",
    })
    .input(RemoveEnrollmentInputSchema)
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const row = await loadEnrollment(context.db, input.id);
      const course = await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        row.courseId,
        "manage",
      );
      return context.db.transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "enrollment.dropped",
          ...activityActor(context),
          courseId: course.id,
          metadata: { enrollmentId: row.id, userId: row.userId, removed: true },
        });
        await tx.delete(enrollment).where(eq(enrollment.id, row.id));
        return { id: row.id };
      });
    }),

  // --- Progress -------------------------------------------------------------

  track: protectedProcedure
    .route({
      method: "POST",
      path: "/lessons/{lessonId}/progress",
      tags: TAGS,
      summary: "Report playback or reading progress on a lesson",
    })
    .input(TrackProgressInputSchema)
    .output(ProgressResultSchema)
    .handler(async ({ input, context }) => {
      const { lesson: row, course } = await requireLessonRead(
        context.db,
        context,
        context.headers,
        input.lessonId,
      );
      const enrolment = await requireLearnerEnrollment(context, course.id);
      const existing = await context.db.query.lessonProgress.findFirst({
        where: and(
          eq(lessonProgress.enrollmentId, enrolment.id),
          eq(lessonProgress.lessonId, row.id),
        ),
      });

      // The furthest point never regresses: re-watching the first minute of a
      // video the learner already finished must not undo their progress.
      const furthestPercent = Math.max(existing?.furthestPercent ?? 0, input.furthestPercent ?? 0);
      const autoComplete =
        row.autoCompleteAtPercent !== null && furthestPercent >= row.autoCompleteAtPercent;

      return context.db.transaction(async (tx) => {
        const progress = firstRow(
          await tx
            .insert(lessonProgress)
            .values({
              enrollmentId: enrolment.id,
              lessonId: row.id,
              status: autoComplete ? "completed" : "in_progress",
              positionSeconds: input.positionSeconds ?? 0,
              furthestPercent,
              secondsSpent: input.secondsSpent ?? 0,
              completedAt: autoComplete ? new Date() : null,
            })
            .onConflictDoUpdate({
              target: [lessonProgress.enrollmentId, lessonProgress.lessonId],
              set: {
                positionSeconds: input.positionSeconds ?? existing?.positionSeconds ?? 0,
                furthestPercent,
                secondsSpent: (existing?.secondsSpent ?? 0) + (input.secondsSpent ?? 0),
                ...(autoComplete && existing?.status !== "completed"
                  ? { status: "completed" as const, completedAt: new Date() }
                  : {}),
              },
            })
            .returning(),
        );
        await tx
          .update(enrollment)
          .set({ lastLessonId: row.id, lastActivityAt: new Date() })
          .where(eq(enrollment.id, enrolment.id));

        const result = await recomputeEnrollmentProgress(tx, enrolment.id);
        const certificateId = result.completed
          ? await maybeIssueCertificate(tx, context, enrolment.id)
          : null;
        return {
          progress,
          courseProgressPercent: result.progressPercent,
          courseCompleted: result.completed,
          certificateId,
        };
      });
    }),

  complete: protectedProcedure
    .route({
      method: "POST",
      path: "/lessons/{lessonId}/complete",
      tags: TAGS,
      summary: "Mark a lesson finished (or unfinished again)",
    })
    .input(CompleteLessonInputSchema)
    .output(ProgressResultSchema)
    .handler(async ({ input, context }) => {
      const { lesson: row, course } = await requireLessonRead(
        context.db,
        context,
        context.headers,
        input.lessonId,
      );
      const enrolment = await requireLearnerEnrollment(context, course.id);

      return context.db.transaction(async (tx) => {
        const progress = firstRow(
          await tx
            .insert(lessonProgress)
            .values({
              enrollmentId: enrolment.id,
              lessonId: row.id,
              status: input.completed ? "completed" : "in_progress",
              completedAt: input.completed ? new Date() : null,
              furthestPercent: input.completed ? 100 : 0,
            })
            .onConflictDoUpdate({
              target: [lessonProgress.enrollmentId, lessonProgress.lessonId],
              set: {
                status: input.completed ? "completed" : "in_progress",
                completedAt: input.completed ? new Date() : null,
              },
            })
            .returning(),
        );
        await tx
          .update(enrollment)
          .set({ lastLessonId: row.id, lastActivityAt: new Date() })
          .where(eq(enrollment.id, enrolment.id));

        const result = await recomputeEnrollmentProgress(tx, enrolment.id);
        const certificateId = result.completed
          ? await maybeIssueCertificate(tx, context, enrolment.id)
          : null;
        if (result.completed) {
          await recordActivity(tx, {
            organizationId: course.organizationId,
            action: "enrollment.completed",
            ...activityActor(context),
            courseId: course.id,
            metadata: { enrollmentId: enrolment.id },
          });
        }
        return {
          progress,
          courseProgressPercent: result.progressPercent,
          courseCompleted: result.completed,
          certificateId,
        };
      });
    }),
};

// ---------------------------------------------------------------------------

/** The caller's active enrolment, or a refusal that names what is missing. */
async function requireLearnerEnrollment(
  context: AuthedContext,
  courseId: string,
): Promise<typeof enrollment.$inferSelect> {
  const row = await findEnrollment(context.db, courseId, context.session.user.id);
  if (!row || (row.status !== "active" && row.status !== "completed")) {
    throw new ORPCError("FORBIDDEN", { message: "Enrol in this course to record progress" });
  }
  return row;
}

/**
 * Issues the completion certificate when the course grants one.
 *
 * Idempotent by way of the unique index on `certificate.enrollment_id`: running
 * the completion check twice must not print a second copy.
 */
async function maybeIssueCertificate(
  tx: Database,
  context: AuthedContext,
  enrollmentId: string,
): Promise<string | null> {
  const enrolment = await tx.query.enrollment.findFirst({
    where: eq(enrollment.id, enrollmentId),
  });
  if (!enrolment) return null;
  const course = await loadCourse(tx, enrolment.courseId);
  if (!course.certificateEnabled) return null;

  const existing = await tx.query.certificate.findFirst({
    where: eq(certificate.enrollmentId, enrollmentId),
  });
  if (existing) return existing.id;

  const holder = await tx.query.user.findFirst({ where: eq(user.id, enrolment.userId) });
  const issued = await issueCertificate(tx, {
    enrollment: enrolment,
    course,
    user: holder ? { id: holder.id, name: holder.name } : null,
  });
  await recordActivity(tx, {
    organizationId: course.organizationId,
    action: "certificate.issued",
    ...activityActor(context),
    courseId: course.id,
    metadata: { certificateId: issued.id, serial: issued.serial },
  });
  return issued.id;
}
