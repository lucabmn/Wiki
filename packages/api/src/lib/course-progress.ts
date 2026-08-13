import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  chapter,
  chapterRelease,
  course,
  enrollment,
  lesson,
  lessonProgress,
} from "@nilovon-wiki/db/schema/index";

import { chapterAvailableAt } from "./course-outline";

/**
 * Keeping an enrolment's denormalized progress honest.
 *
 * `enrollment.progress_percent` exists because "my courses" renders a bar per
 * card and recomputing it per card is a query per row. Everything that can move
 * a learner forward — completing a lesson, an author marking a lesson optional,
 * a lesson being deleted — has to run through here, or the number drifts away
 * from the lessons it claims to summarize.
 */

/** Executor shape shared by the db handle and a transaction. */
type Executor = Pick<Database, "select" | "update" | "insert" | "query">;

export type ProgressUpdate = {
  progressPercent: number;
  completed: boolean;
};

/**
 * Recomputes one enrolment's progress and, when the course's threshold is
 * crossed for the first time, stamps `completedAt`.
 *
 * Completion is a one-way door: an author who later adds a lesson must not
 * un-complete a course somebody already finished, and a certificate that was
 * issued must keep the completion it attests to. So `completedAt` is only ever
 * set, never cleared here.
 */
export async function recomputeEnrollmentProgress(
  db: Executor,
  enrollmentId: string,
): Promise<ProgressUpdate> {
  const row = await db.query.enrollment.findFirst({
    where: eq(enrollment.id, enrollmentId),
    columns: { id: true, courseId: true, completedAt: true, status: true },
  });
  if (!row) return { progressPercent: 0, completed: false };

  const [courseRow, lessons, progress] = await Promise.all([
    db.query.course.findFirst({
      where: eq(course.id, row.courseId),
      columns: { completionThreshold: true },
    }),
    db.query.lesson.findMany({
      where: eq(lesson.courseId, row.courseId),
      columns: { id: true, isRequired: true, publishedAt: true },
    }),
    db.query.lessonProgress.findMany({
      where: eq(lessonProgress.enrollmentId, enrollmentId),
      columns: { lessonId: true, status: true },
    }),
  ]);

  // Only published lessons count: a draft the learner cannot open must not hold
  // their progress down.
  const live = lessons.filter((item) => item.publishedAt !== null);
  const required = live.filter((item) => item.isRequired);
  const pool = required.length > 0 ? required : live;
  const done = new Set(
    progress.filter((item) => item.status === "completed").map((item) => item.lessonId),
  );
  const progressPercent =
    pool.length === 0
      ? 0
      : Math.round((pool.filter((item) => done.has(item.id)).length / pool.length) * 100);

  const threshold = courseRow?.completionThreshold ?? 100;
  const completed = progressPercent >= threshold;
  const firstCompletion = completed && row.completedAt === null;

  await db
    .update(enrollment)
    .set({
      progressPercent,
      lastActivityAt: new Date(),
      ...(firstCompletion ? { completedAt: new Date(), status: "completed" as const } : {}),
    })
    .where(eq(enrollment.id, enrollmentId));

  return { progressPercent, completed: firstCompletion };
}

/**
 * Materializes the drip schedule for a new enrolment.
 *
 * Written down rather than derived on read, because an author who later
 * shortens a delay must not retroactively change what a learner was already
 * told, and re-enrolling must not re-lock material they have already seen.
 */
export async function seedChapterReleases(
  db: Executor,
  enrollmentId: string,
  courseId: string,
  enrolledAt: Date,
): Promise<void> {
  const chapters = await db.query.chapter.findMany({
    where: eq(chapter.courseId, courseId),
    columns: { id: true, availableFrom: true, dripDelayDays: true },
  });
  const rows = chapters
    .map((item) => ({ chapterId: item.id, releasesAt: chapterAvailableAt(item, enrolledAt) }))
    .filter((item): item is { chapterId: string; releasesAt: Date } => item.releasesAt !== null)
    .map((item) => ({ enrollmentId, chapterId: item.chapterId, releasesAt: item.releasesAt }));
  if (rows.length === 0) return;
  await db.insert(chapterRelease).values(rows).onConflictDoNothing();
}

/** Lesson ids in a course that are published — the pool progress is measured against. */
export async function publishedLessonIds(db: Executor, courseId: string): Promise<string[]> {
  const rows = await db.query.lesson.findMany({
    where: eq(lesson.courseId, courseId),
    columns: { id: true, publishedAt: true },
  });
  return rows.filter((row) => row.publishedAt !== null).map((row) => row.id);
}

/** How many of a set of lessons one enrolment has completed. */
export async function completedLessonCount(
  db: Executor,
  enrollmentId: string,
  lessonIds: string[],
): Promise<number> {
  if (lessonIds.length === 0) return 0;
  const rows = await db.query.lessonProgress.findMany({
    where: and(
      eq(lessonProgress.enrollmentId, enrollmentId),
      inArray(lessonProgress.lessonId, lessonIds),
      eq(lessonProgress.status, "completed"),
    ),
    columns: { id: true },
  });
  return rows.length;
}
