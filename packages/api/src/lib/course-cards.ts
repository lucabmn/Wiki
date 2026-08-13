import { and, avg, count, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  course,
  courseReview,
  courseTopic,
  courseTopicLink,
  enrollment,
  lesson,
} from "@nilovon-wiki/db/schema/index";

import type { CourseAccess, CourseCapability } from "./course-access";
import { roleAllows } from "./course-access";

/**
 * Turning course rows into catalog cards.
 *
 * Every count a card shows — lessons, enrolments, ratings, topics, the caller's
 * own progress — is fetched for the whole page in one query per fact rather
 * than per card. A catalog of 50 courses therefore costs five queries, not 250.
 */

/** Public URL for a stored course asset. Mirrors the attachment proxy routes. */
export function courseAssetUrl(assetId: string | null | undefined): string | null {
  return assetId ? `/course-assets/${assetId}/inline` : null;
}

/** Projects a resolved access decision onto the flags the client renders. */
export function accessFlags(access: CourseAccess) {
  const allows = (capability: CourseCapability) => roleAllows(access.role, capability);
  return {
    canView: access.canView,
    canLearn: access.canLearn,
    role: access.role,
    canAuthor: allows("author"),
    canGrade: allows("grade"),
    canManage: allows("manage"),
  };
}

export type CourseCardFacts = {
  lessonCount: Map<string, number>;
  enrollmentCount: Map<string, number>;
  rating: Map<string, { average: number; count: number }>;
  topics: Map<string, { id: string; name: string; color: string | null }[]>;
  enrollment: Map<
    string,
    { id: string; status: string; progressPercent: number; lastLessonId: string | null }
  >;
};

const EMPTY_FACTS: CourseCardFacts = {
  lessonCount: new Map(),
  enrollmentCount: new Map(),
  rating: new Map(),
  topics: new Map(),
  enrollment: new Map(),
};

/**
 * Loads every aggregate a batch of course cards needs, in parallel.
 *
 * `userId` scopes only the enrolment lookup — the counts are the same for
 * everyone, which is what lets this be cached per organization later without
 * leaking one learner's progress into another's catalog.
 */
export async function loadCourseCardFacts(
  db: Database,
  courseIds: string[],
  userId: string | null,
): Promise<CourseCardFacts> {
  if (courseIds.length === 0) return EMPTY_FACTS;

  const [lessons, enrollments, ratings, topicRows, mine] = await Promise.all([
    db
      .select({ courseId: lesson.courseId, value: count() })
      .from(lesson)
      .where(inArray(lesson.courseId, courseIds))
      .groupBy(lesson.courseId),
    db
      .select({ courseId: enrollment.courseId, value: count() })
      .from(enrollment)
      // Pending and dropped learners are not "enrolled" for display purposes:
      // the number on a card is how many people are actually taking it.
      .where(
        and(
          inArray(enrollment.courseId, courseIds),
          inArray(enrollment.status, ["active", "completed"]),
        ),
      )
      .groupBy(enrollment.courseId),
    db
      .select({
        courseId: courseReview.courseId,
        average: avg(courseReview.rating),
        value: count(),
      })
      .from(courseReview)
      .where(inArray(courseReview.courseId, courseIds))
      .groupBy(courseReview.courseId),
    db
      .select({
        courseId: courseTopicLink.courseId,
        id: courseTopic.id,
        name: courseTopic.name,
        color: courseTopic.color,
      })
      .from(courseTopicLink)
      .innerJoin(courseTopic, eq(courseTopicLink.topicId, courseTopic.id))
      .where(inArray(courseTopicLink.courseId, courseIds)),
    userId
      ? db
          .select({
            courseId: enrollment.courseId,
            id: enrollment.id,
            status: enrollment.status,
            progressPercent: enrollment.progressPercent,
            lastLessonId: enrollment.lastLessonId,
          })
          .from(enrollment)
          .where(and(inArray(enrollment.courseId, courseIds), eq(enrollment.userId, userId)))
      : Promise.resolve([]),
  ]);

  const topics = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const row of topicRows) {
    const list = topics.get(row.courseId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    topics.set(row.courseId, list);
  }

  return {
    lessonCount: new Map(lessons.map((row) => [row.courseId, Number(row.value)])),
    enrollmentCount: new Map(enrollments.map((row) => [row.courseId, Number(row.value)])),
    rating: new Map(
      ratings.map((row) => [
        row.courseId,
        { average: row.average === null ? 0 : Number(row.average), count: Number(row.value) },
      ]),
    ),
    topics,
    enrollment: new Map(
      mine.map((row) => [
        row.courseId,
        {
          id: row.id,
          status: row.status,
          progressPercent: row.progressPercent,
          lastLessonId: row.lastLessonId,
        },
      ]),
    ),
  };
}

type CourseRow = typeof course.$inferSelect;

/**
 * The wire shape of a course. Drops the server-only columns (`textContent`, the
 * search vector) and resolves the thumbnail into a URL the browser can use, so
 * no caller has to know how assets are addressed.
 */
export function toCourse(row: CourseRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    thumbnailAssetId: row.thumbnailAssetId,
    thumbnailUrl: courseAssetUrl(row.thumbnailAssetId),
    status: row.status,
    visibility: row.visibility,
    enrollmentPolicy: row.enrollmentPolicy,
    level: row.level,
    language: row.language,
    estimatedMinutes: row.estimatedMinutes,
    sequential: row.sequential,
    completionThreshold: row.completionThreshold,
    certificateEnabled: row.certificateEnabled,
    enrollmentClosesAt: row.enrollmentClosesAt,
    maxSeats: row.maxSeats,
    createdBy: row.createdBy,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Assembles one card from a row, the batch facts, and the caller's access. */
export function toCourseCard(row: CourseRow, facts: CourseCardFacts, access: CourseAccess) {
  const rating = facts.rating.get(row.id);
  const mine = facts.enrollment.get(row.id);
  return {
    ...toCourse(row),
    lessonCount: facts.lessonCount.get(row.id) ?? 0,
    enrollmentCount: facts.enrollmentCount.get(row.id) ?? 0,
    averageRating: rating && rating.count > 0 ? Math.round(rating.average * 10) / 10 : null,
    reviewCount: rating?.count ?? 0,
    topics: facts.topics.get(row.id) ?? [],
    enrollment: mine
      ? {
          id: mine.id,
          status: mine.status as "pending" | "active" | "completed" | "dropped",
          progressPercent: mine.progressPercent,
          lastLessonId: mine.lastLessonId,
        }
      : null,
    access: accessFlags(access),
  };
}

/** Seats still available, or null when the course is uncapped. */
export async function seatsLeft(db: Database, row: CourseRow): Promise<number | null> {
  if (row.maxSeats === null) return null;
  const [taken] = await db
    .select({ value: count() })
    .from(enrollment)
    .where(
      and(eq(enrollment.courseId, row.id), inArray(enrollment.status, ["active", "completed"])),
    );
  return Math.max(0, row.maxSeats - Number(taken?.value ?? 0));
}

/**
 * Courses in an organization that are not in the trash, optionally narrowed by
 * a free-text query against the same weighted FTS vector the wiki search uses.
 */
export function courseListWhere(organizationId: string, query?: string) {
  return and(
    eq(course.organizationId, organizationId),
    isNull(course.deletedAt),
    query ? sql`${course.searchVector} @@ websearch_to_tsquery('german', ${query})` : undefined,
  );
}
