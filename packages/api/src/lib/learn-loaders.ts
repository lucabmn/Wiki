import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  assignment,
  chapter,
  course,
  courseAsset,
  courseCollection,
  enrollment,
  lesson,
  quiz,
  submission,
} from "@nilovon-wiki/db/schema/index";

import type { LoadOptions } from "./loaders";

/**
 * Row loaders for the learning product. Same contract as `loaders.ts`: they
 * throw NOT_FOUND rather than returning null, and they hide trashed rows unless
 * asked, so a new endpoint inherits the soft-delete rule without knowing it.
 */

type Row<T> = NonNullable<Awaited<T>>;

/** Loads a course or throws NOT_FOUND. Trashed courses are hidden by default. */
export async function loadCourse(db: Database, id: string, options: LoadOptions = {}) {
  const row = await db.query.course.findFirst({ where: eq(course.id, id) });
  if (!row || (row.deletedAt && !options.includeTrashed)) {
    throw new ORPCError("NOT_FOUND", { message: "Course not found" });
  }
  return row;
}

/** Loads a course by its org-scoped slug. */
export async function loadCourseBySlug(db: Database, organizationId: string, slug: string) {
  const row = await db.query.course.findFirst({
    where: (fields, { and, eq: equals, isNull }) =>
      and(
        equals(fields.organizationId, organizationId),
        equals(fields.slug, slug),
        isNull(fields.deletedAt),
      ),
  });
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Course not found" });
  }
  return row;
}

export async function loadChapter(db: Database, id: string) {
  const row = await db.query.chapter.findFirst({ where: eq(chapter.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Chapter not found" });
  return row;
}

export async function loadLesson(db: Database, id: string) {
  const row = await db.query.lesson.findFirst({ where: eq(lesson.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Lesson not found" });
  return row;
}

export async function loadCollection(db: Database, id: string) {
  const row = await db.query.courseCollection.findFirst({ where: eq(courseCollection.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Collection not found" });
  return row;
}

export async function loadCourseAsset(db: Database, id: string) {
  const row = await db.query.courseAsset.findFirst({ where: eq(courseAsset.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Asset not found" });
  return row;
}

export async function loadEnrollment(db: Database, id: string) {
  const row = await db.query.enrollment.findFirst({ where: eq(enrollment.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Enrollment not found" });
  return row;
}

export async function loadAssignment(db: Database, id: string) {
  const row = await db.query.assignment.findFirst({ where: eq(assignment.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Assignment not found" });
  return row;
}

export async function loadSubmission(db: Database, id: string) {
  const row = await db.query.submission.findFirst({ where: eq(submission.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Submission not found" });
  return row;
}

export async function loadQuiz(db: Database, id: string) {
  const row = await db.query.quiz.findFirst({ where: eq(quiz.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Quiz not found" });
  return row;
}

/** The caller's enrolment in a course, or null — never throws. */
export async function findEnrollment(db: Database, courseId: string, userId: string) {
  return (
    (await db.query.enrollment.findFirst({
      where: (fields, { and, eq: equals }) =>
        and(equals(fields.courseId, courseId), equals(fields.userId, userId)),
    })) ?? null
  );
}

/** The caller's enrolment, or NOT_FOUND when they are not in the course. */
export async function requireEnrollment(db: Database, courseId: string, userId: string) {
  const row = await findEnrollment(db, courseId, userId);
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Not enrolled in this course" });
  return row;
}

export type CourseRow = Row<ReturnType<typeof loadCourse>>;
export type ChapterRow = Row<ReturnType<typeof loadChapter>>;
export type LessonRow = Row<ReturnType<typeof loadLesson>>;
export type EnrollmentRow = Row<ReturnType<typeof loadEnrollment>>;
export type AssignmentRow = Row<ReturnType<typeof loadAssignment>>;
export type SubmissionRow = Row<ReturnType<typeof loadSubmission>>;
