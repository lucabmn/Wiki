import { and, avg, count, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import {
  assignment,
  certificate,
  chapter,
  course,
  courseReview,
  enrollment,
  lesson,
  lessonProgress,
  submission,
} from "@nilovon-wiki/db/schema/index";

import { protectedProcedure, requireActiveOrg } from "../index";
import { publishedLessonIds } from "../lib/course-progress";
import { requireCourseCapability } from "../lib/learn-authz";
import { loadCourse } from "../lib/learn-loaders";
import { firstRow } from "../lib/rows";
import { EnrollmentStatusSchema } from "../schemas/enrollment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Learning analytics"];

/** How far ahead "due soon" looks on the learner's own overview. */
const DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// The contracts below are declared here rather than in `schemas/` — the only
// place aggregates live today is `schemas/misc.ts`, which belongs to the wiki
// dashboard, and this slice owns no analytics schema file to put them in.

const CourseAnalyticsInputSchema = z.object({ courseId: IdSchema });

const CourseAnalyticsSchema = z.object({
  courseId: IdSchema,
  /** Every enrolment row, including pending requests and people who left. */
  enrollmentCount: z.number().int(),
  activeCount: z.number().int(),
  completedCount: z.number().int(),
  droppedCount: z.number().int(),
  /** Mean of the denormalized `progressPercent`, 0..100. */
  averageProgressPercent: z.number(),
  /** Share of enrolments that finished, 0..100 — same unit as the progress. */
  completionRate: z.number(),
  /** Null, not zero, when nobody has rated the course yet. */
  averageRating: z.number().nullable(),
  reviewCount: z.number().int(),
  /** Hand-ins waiting for a grader. */
  awaitingGrading: z.number().int(),
});

const LessonFunnelSchema = z.object({
  courseId: IdSchema,
  /** The denominator: learners who could have reached these lessons. */
  enrollmentCount: z.number().int(),
  lessons: z.array(
    z.object({
      lessonId: IdSchema,
      title: z.string(),
      chapterId: IdSchema,
      chapterTitle: z.string(),
      isRequired: z.boolean(),
      published: z.boolean(),
      startedCount: z.number().int(),
      completedCount: z.number().int(),
    }),
  ),
});

const LearnerProgressInputSchema = z.object({
  courseId: IdSchema,
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const LearnerProgressSchema = z.object({
  courseId: IdSchema,
  totalLessons: z.number().int(),
  learners: z.array(
    z.object({
      enrollmentId: IdSchema,
      userId: IdSchema,
      /** Empty when the account was deleted; the enrolment outlives it. */
      name: z.string(),
      status: EnrollmentStatusSchema,
      progressPercent: z.number().int(),
      lastActivityAt: z.date().nullable(),
      lessonsCompleted: z.number().int(),
    }),
  ),
});

const MyLearningSchema = z.object({
  coursesInProgress: z.number().int(),
  coursesCompleted: z.number().int(),
  certificatesEarned: z.number().int(),
  assignmentsDueSoon: z.array(
    z.object({
      assignmentId: IdSchema,
      lessonId: IdSchema,
      title: z.string(),
      courseId: IdSchema,
      courseTitle: z.string(),
      dueAt: z.date(),
    }),
  ),
});

export const learnAnalyticsRouter = {
  courseOverview: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/analytics",
      tags: TAGS,
      summary: "Aggregate numbers for one course",
    })
    .input(CourseAnalyticsInputSchema)
    .output(CourseAnalyticsSchema)
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "view");

      const assignmentIds = (
        await context.db
          .select({ id: assignment.id })
          .from(assignment)
          .where(eq(assignment.courseId, courseRow.id))
      ).map((row) => row.id);

      const enrolledIn = eq(enrollment.courseId, courseRow.id);
      const enrolmentCount = (status: "active" | "completed" | "dropped") =>
        context.db
          .select({ n: count() })
          .from(enrollment)
          .where(and(enrolledIn, eq(enrollment.status, status)));

      const [total, active, completed, dropped, progress, rating, awaiting] = await Promise.all([
        context.db.select({ n: count() }).from(enrollment).where(enrolledIn),
        enrolmentCount("active"),
        enrolmentCount("completed"),
        enrolmentCount("dropped"),
        context.db
          .select({ average: avg(enrollment.progressPercent) })
          .from(enrollment)
          .where(enrolledIn),
        context.db
          .select({ average: avg(courseReview.rating), n: count() })
          .from(courseReview)
          .where(eq(courseReview.courseId, courseRow.id)),
        // No assignments → nothing can be awaiting a grade. Answered without a
        // query, because an empty `inArray` is a SQL error.
        assignmentIds.length
          ? context.db
              .select({ n: count() })
              .from(submission)
              .where(
                and(
                  inArray(submission.assignmentId, assignmentIds),
                  // `returned` is back with the learner and `draft` was never
                  // handed in; only `submitted` is on a grader's desk.
                  eq(submission.status, "submitted"),
                ),
              )
          : Promise.resolve([{ n: 0 }]),
      ]);

      const enrollmentCount = firstRow(total).n;
      const completedCount = firstRow(completed).n;
      const ratings = firstRow(rating);
      return {
        courseId: courseRow.id,
        enrollmentCount,
        activeCount: firstRow(active).n,
        completedCount,
        droppedCount: firstRow(dropped).n,
        // `avg` is null over zero rows, and dividing by an empty roster is a
        // NaN the client would render as "NaN%".
        averageProgressPercent: Math.round(Number(firstRow(progress).average ?? 0)),
        completionRate:
          enrollmentCount === 0 ? 0 : Math.round((completedCount / enrollmentCount) * 100),
        averageRating:
          ratings.n > 0 && ratings.average !== null
            ? Math.round(Number(ratings.average) * 10) / 10
            : null,
        reviewCount: ratings.n,
        awaitingGrading: firstRow(awaiting).n,
      };
    }),

  lessonFunnel: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/analytics/lessons",
      tags: TAGS,
      summary: "Per lesson: how many learners started it and how many finished",
    })
    .input(CourseAnalyticsInputSchema)
    .output(LessonFunnelSchema)
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "view");

      // Course reading order: chapters by their fractional position, then the
      // lessons within each. A funnel out of order says nothing about where
      // people drop out.
      const lessons = await context.db
        .select({
          id: lesson.id,
          title: lesson.title,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          isRequired: lesson.isRequired,
          publishedAt: lesson.publishedAt,
        })
        .from(lesson)
        .innerJoin(chapter, eq(lesson.chapterId, chapter.id))
        .where(eq(lesson.courseId, courseRow.id))
        .orderBy(chapter.position, lesson.position);
      const lessonIds = lessons.map((row) => row.id);

      const [enrolled, progressRows] = await Promise.all([
        context.db
          .select({ n: count() })
          .from(enrollment)
          .where(
            and(
              eq(enrollment.courseId, courseRow.id),
              inArray(enrollment.status, ["active", "completed"]),
            ),
          ),
        // A `lesson_progress` row exists only once a learner opened the lesson,
        // so its mere presence is "started". One grouped query rather than two
        // per lesson; skipped entirely on an empty course to dodge `inArray`.
        lessonIds.length
          ? context.db
              .select({
                lessonId: lessonProgress.lessonId,
                started: count(),
                completed: sql<number>`count(*) filter (where ${eq(lessonProgress.status, "completed")})`,
              })
              .from(lessonProgress)
              .where(inArray(lessonProgress.lessonId, lessonIds))
              .groupBy(lessonProgress.lessonId)
          : Promise.resolve([]),
      ]);

      const byLesson = new Map(
        progressRows.map((row) => [
          row.lessonId,
          { started: Number(row.started), completed: Number(row.completed) },
        ]),
      );

      return {
        courseId: courseRow.id,
        enrollmentCount: firstRow(enrolled).n,
        lessons: lessons.map((row) => {
          const counts = byLesson.get(row.id);
          return {
            lessonId: row.id,
            title: row.title,
            chapterId: row.chapterId,
            chapterTitle: row.chapterTitle,
            isRequired: row.isRequired,
            published: row.publishedAt !== null,
            startedCount: counts?.started ?? 0,
            completedCount: counts?.completed ?? 0,
          };
        }),
      };
    }),

  learnerProgress: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/analytics/learners",
      tags: TAGS,
      summary: "Per learner: how far they are and when they were last active",
    })
    .input(LearnerProgressInputSchema)
    .output(LearnerProgressSchema)
    .handler(async ({ input, context }) => {
      // The aggregates above are anonymous; this one names individuals and says
      // when each of them last worked. That is a statement about a person, so it
      // takes the grant that already implies seeing their work rather than the
      // one that only implies reading the course.
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "grade");

      const [rows, lessonIds] = await Promise.all([
        context.db.query.enrollment.findMany({
          where: eq(enrollment.courseId, courseRow.id),
          // Only the name: the roster is where staff go for contact details.
          with: { user: { columns: { id: true, name: true } } },
          orderBy: [desc(enrollment.lastActivityAt), desc(enrollment.enrolledAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        publishedLessonIds(context.db, courseRow.id),
      ]);

      const enrollmentIds = rows.map((row) => row.id);
      // One grouped query for the whole page instead of a count per learner.
      const completedRows =
        enrollmentIds.length && lessonIds.length
          ? await context.db
              .select({ enrollmentId: lessonProgress.enrollmentId, n: count() })
              .from(lessonProgress)
              .where(
                and(
                  inArray(lessonProgress.enrollmentId, enrollmentIds),
                  // Lessons the author has not published do not count against a
                  // learner, the same pool `recomputeEnrollmentProgress` uses.
                  inArray(lessonProgress.lessonId, lessonIds),
                  eq(lessonProgress.status, "completed"),
                ),
              )
              .groupBy(lessonProgress.enrollmentId)
          : [];
      const completedByEnrollment = new Map(
        completedRows.map((row) => [row.enrollmentId, Number(row.n)]),
      );

      return {
        courseId: courseRow.id,
        totalLessons: lessonIds.length,
        learners: rows.map((row) => ({
          enrollmentId: row.id,
          userId: row.userId,
          name: row.user?.name ?? "",
          status: row.status,
          progressPercent: row.progressPercent,
          lastActivityAt: row.lastActivityAt,
          lessonsCompleted: completedByEnrollment.get(row.id) ?? 0,
        })),
      };
    }),

  myLearning: protectedProcedure
    .route({
      method: "GET",
      path: "/learn/overview",
      tags: TAGS,
      summary: "The signed-in learner's own summary for the active organization",
    })
    // GET input must be an object (not z.void()) for the OpenAPI surface.
    .input(z.object({}))
    .output(MyLearningSchema)
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;

      const [enrolments, certificates] = await Promise.all([
        // Joined through `course` because an enrolment carries no organization
        // of its own, and this overview is about one organization at a time.
        context.db
          .select({
            courseId: course.id,
            courseTitle: course.title,
            status: enrollment.status,
          })
          .from(enrollment)
          .innerJoin(course, eq(enrollment.courseId, course.id))
          .where(
            and(
              eq(enrollment.userId, userId),
              eq(course.organizationId, organizationId),
              isNull(course.deletedAt),
            ),
          ),
        context.db
          .select({ n: count() })
          .from(certificate)
          .where(
            and(
              eq(certificate.userId, userId),
              eq(certificate.organizationId, organizationId),
              // A revoked certificate is not one the learner earned any more.
              eq(certificate.status, "issued"),
            ),
          ),
      ]);

      // Only courses the learner can actually work on can produce a deadline;
      // pending requests and dropped courses cannot.
      const openCourses = enrolments.filter(
        (row) => row.status === "active" || row.status === "completed",
      );
      const titleByCourse = new Map(openCourses.map((row) => [row.courseId, row.courseTitle]));

      return {
        coursesInProgress: enrolments.filter((row) => row.status === "active").length,
        coursesCompleted: enrolments.filter((row) => row.status === "completed").length,
        certificatesEarned: firstRow(certificates).n,
        assignmentsDueSoon: titleByCourse.size
          ? await dueSoon(context.db, userId, titleByCourse)
          : [],
      };
    }),
};

// ---------------------------------------------------------------------------

/**
 * Published assignments falling due within the next week that the learner has
 * not handed in yet. Anything already submitted or graded is off their plate,
 * so listing it would turn the overview into noise they cannot act on.
 */
async function dueSoon(db: Database, userId: string, titleByCourse: Map<string, string>) {
  const now = new Date();
  const courseIds = [...titleByCourse.keys()];
  const rows = await db
    .select({
      id: assignment.id,
      lessonId: assignment.lessonId,
      courseId: assignment.courseId,
      title: assignment.title,
      dueAt: assignment.dueAt,
    })
    .from(assignment)
    .where(
      and(
        inArray(assignment.courseId, courseIds),
        isNotNull(assignment.publishedAt),
        gte(assignment.dueAt, now),
        lte(assignment.dueAt, new Date(now.getTime() + DUE_SOON_MS)),
      ),
    )
    .orderBy(assignment.dueAt)
    .limit(20);
  if (rows.length === 0) return [];

  const handedIn = new Set(
    (
      await db
        .select({ assignmentId: submission.assignmentId })
        .from(submission)
        .where(
          and(
            eq(submission.userId, userId),
            inArray(
              submission.assignmentId,
              rows.map((row) => row.id),
            ),
            // `draft` is started but not handed in, and `returned` was sent back
            // for rework — both are still the learner's to do.
            inArray(submission.status, ["submitted", "graded"]),
          ),
        )
    ).map((row) => row.assignmentId),
  );

  return rows.flatMap((row) =>
    handedIn.has(row.id) || row.dueAt === null
      ? []
      : [
          {
            assignmentId: row.id,
            lessonId: row.lessonId,
            title: row.title,
            courseId: row.courseId,
            courseTitle: titleByCourse.get(row.courseId) ?? "",
            dueAt: row.dueAt,
          },
        ],
  );
}
