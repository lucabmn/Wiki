import { index, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../_helpers";
import { user } from "../auth";
import { learnSchema } from "./_schema";
import { chapter, lesson } from "./chapters";
import { course } from "./courses";
import { enrollmentSource, enrollmentStatus, progressStatus } from "./enums";

/**
 * One learner in one course — the row that grants read access to a course's
 * content and anchors everything the learner produces (progress, submissions,
 * quiz attempts, the certificate).
 *
 * Exactly one row per (course, user) for the lifetime of the pair: leaving a
 * course sets `status = 'dropped'` rather than deleting, so re-enrolling
 * restores the progress instead of silently starting over.
 */
export const enrollment = learnSchema.table(
  "enrollment",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: enrollmentStatus("status").notNull().default("active"),
    source: enrollmentSource("source").notNull().default("self"),
    /** Who added them, for `source = 'invite'`. */
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    /**
     * Denormalized 0..100 completion, recomputed on every progress write. Kept
     * on the row because "my courses" renders a progress bar per card and
     * recomputing it per card is a query per row.
     */
    progressPercent: integer("progress_percent").notNull().default(0),
    /** Drives "continue where you left off". */
    lastLessonId: text("last_lesson_id").references(() => lesson.id, { onDelete: "set null" }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the completion threshold is first crossed; never recomputed. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("enrollment_course_user_uq").on(t.courseId, t.userId),
    index("enrollment_user_status_idx").on(t.userId, t.status),
    index("enrollment_course_status_idx").on(t.courseId, t.status),
  ],
);

/**
 * A learner's state on one lesson. Rows are created lazily on first open, so
 * their absence means `not_started` and a course with 200 lessons costs nothing
 * until it is actually taken.
 */
export const lessonProgress = learnSchema.table(
  "lesson_progress",
  {
    id: id(),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => enrollment.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    status: progressStatus("status").notNull().default("in_progress"),
    /** Resume point in seconds for video, scroll percent for documents. */
    positionSeconds: integer("position_seconds").notNull().default(0),
    /** Furthest point reached, 0..100 — resume must not regress on a re-watch. */
    furthestPercent: integer("furthest_percent").notNull().default(0),
    /** Accumulated time on the lesson; feeds instructor analytics. */
    secondsSpent: integer("seconds_spent").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lesson_progress_uq").on(t.enrollmentId, t.lessonId),
    index("lesson_progress_lesson_idx").on(t.lessonId),
    index("lesson_progress_status_idx").on(t.enrollmentId, t.status),
  ],
);

/**
 * When a dripped chapter became readable for one learner.
 *
 * Materialized rather than derived from `enrolledAt + dripDelayDays`, because
 * an author who shortens the delay must not retroactively change what a learner
 * was already told, and re-enrolment must not re-lock content they have seen.
 */
export const chapterRelease = learnSchema.table(
  "chapter_release",
  {
    id: id(),
    enrollmentId: text("enrollment_id")
      .notNull()
      .references(() => enrollment.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    releasesAt: timestamp("releases_at", { withTimezone: true }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("chapter_release_uq").on(t.enrollmentId, t.chapterId),
    index("chapter_release_chapter_idx").on(t.chapterId),
  ],
);
