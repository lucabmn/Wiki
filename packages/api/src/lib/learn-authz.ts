// Router-facing course authorization. Wraps the pure resolvers in
// `course-access.ts` with the org-manager override (an auth round-trip),
// resolved once per call. Kept separate so `course-access.ts` stays free of
// better-auth and env imports and its truth table stays unit-testable.

import { ORPCError } from "@orpc/server";

import type { Database } from "@nilovon-wiki/db";

import type { AuthedContext } from "../context";
import { isOrgManager } from "../index";
import {
  assertCourseCapability,
  assertCourseLearn,
  assertCourseView,
  buildCourseViewFilter,
  loadCourseAccess,
  viewableCourseIds,
  type CourseAccess,
  type CourseAccessInput,
  type CourseCapability,
} from "./course-access";
import { loadChapter, loadCourse, loadLesson } from "./learn-loaders";

/** The caller's access to a course, with the org-manager override resolved. */
export async function resolveAccess(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  course: CourseAccessInput,
): Promise<CourseAccess> {
  const manager = await isOrgManager(headers, course.organizationId);
  return loadCourseAccess(db, context, course, manager);
}

/** Assert the caller may at least see that the course exists. */
export async function requireCourseView(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  course: CourseAccessInput,
): Promise<CourseAccess> {
  const manager = await isOrgManager(headers, course.organizationId);
  return assertCourseView(db, context, course, manager);
}

/** Assert the caller may open the course's content. */
export async function requireCourseLearn(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  course: CourseAccessInput,
): Promise<CourseAccess> {
  const manager = await isOrgManager(headers, course.organizationId);
  return assertCourseLearn(db, context, course, manager);
}

/** Assert the caller holds `capability` as staff on the course. */
export async function requireCourseCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  course: CourseAccessInput,
  capability: CourseCapability,
): Promise<CourseAccess> {
  const manager = await isOrgManager(headers, course.organizationId);
  return assertCourseCapability(db, context, course, capability, manager);
}

/** Resolve a course by id, then assert a capability. Returns the loaded row. */
export async function requireCourseCapabilityById(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  courseId: string,
  capability: CourseCapability,
) {
  const row = await loadCourse(db, courseId);
  await requireCourseCapability(db, context, headers, row, capability);
  return row;
}

/**
 * Resolve a chapter and assert a capability on its course. Chapters and lessons
 * have no access rules of their own — they inherit the course's entirely, which
 * is why every gate here routes through the course row.
 */
export async function requireChapterCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  chapterId: string,
  capability: CourseCapability,
) {
  const row = await loadChapter(db, chapterId);
  const course = await loadCourse(db, row.courseId);
  await requireCourseCapability(db, context, headers, course, capability);
  return { chapter: row, course };
}

/** Resolve a lesson and assert a capability on its course. */
export async function requireLessonCapability(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  lessonId: string,
  capability: CourseCapability,
) {
  const row = await loadLesson(db, lessonId);
  const course = await loadCourse(db, row.courseId);
  await requireCourseCapability(db, context, headers, course, capability);
  return { lesson: row, course };
}

/**
 * Resolve a lesson the caller wants to *consume*. Staff bypass publication;
 * learners need an enrolment and a published lesson.
 */
export async function requireLessonRead(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  lessonId: string,
) {
  const row = await loadLesson(db, lessonId);
  const course = await loadCourse(db, row.courseId);
  const access = await requireCourseLearn(db, context, headers, course);
  if (!access.role && !row.publishedAt) {
    // An unpublished lesson is invisible to learners even inside a course they
    // are enrolled in — authors need a place to work in the open.
    throw new ORPCError("NOT_FOUND");
  }
  return { lesson: row, course, access };
}

/** Batch `canView` predicate with the org-manager override resolved. */
export async function courseViewFilter(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  organizationId: string,
) {
  const manager = await isOrgManager(headers, organizationId);
  return buildCourseViewFilter(db, context, manager);
}

/** Ids of every course in the org the caller may see. */
export async function viewableCourses(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  organizationId: string,
): Promise<string[]> {
  const manager = await isOrgManager(headers, organizationId);
  return viewableCourseIds(db, context, organizationId, manager);
}
