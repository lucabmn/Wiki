import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../_helpers";
import { user } from "../auth";
import { learnSchema } from "./_schema";
import { lesson } from "./chapters";
import { course, courseAsset } from "./courses";
import { assignmentTaskKind, gradingMethod, submissionStatus } from "./enums";
import { quiz, quizAttempt } from "./quizzes";

/**
 * A hand-in, always attached to exactly one lesson of kind `assignment`. The
 * one-to-one is enforced by a unique index on `lesson_id` rather than by
 * folding these columns into `lesson`, because an assignment carries a dozen
 * fields that are null for every other lesson kind.
 */
export const assignment = learnSchema.table(
  "assignment",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Rich brief (TipTap JSON). */
    instructions: jsonb("instructions"),
    instructionsText: text("instructions_text").notNull().default(""),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Total points across all tasks; the API keeps it equal to their sum. */
    maxGrade: integer("max_grade").notNull().default(100),
    /** Points needed to pass. */
    passingGrade: integer("passing_grade").notNull().default(60),
    gradingMethod: gradingMethod("grading_method").notNull().default("manual"),
    allowLateSubmission: boolean("allow_late_submission").notNull().default(true),
    /** `null` = unlimited resubmissions until graded. */
    maxAttempts: integer("max_attempts"),
    /** Graders see submitter identity hidden until a grade is recorded. */
    blindGrading: boolean("blind_grading").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("assignment_lesson_uq").on(t.lessonId),
    index("assignment_course_idx").on(t.courseId),
    index("assignment_due_idx").on(t.dueAt),
  ],
);

/** One thing the learner has to produce. An assignment has one or more. */
export const assignmentTask = learnSchema.table(
  "assignment_task",
  {
    id: id(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignment.id, { onDelete: "cascade" }),
    kind: assignmentTaskKind("kind").notNull().default("text"),
    title: text("title").notNull(),
    description: jsonb("description"),
    position: text("position").notNull().default("a0"),
    maxGrade: integer("max_grade").notNull().default(100),
    /** kind=quiz: the quiz to answer. Auto-graded on submit. */
    quizId: text("quiz_id").references(() => quiz.id, { onDelete: "set null" }),
    /**
     * kind=file: upload constraints — `{ maxBytes, maxFiles, mimeTypes: [] }`.
     * JSON rather than columns because the set differs per task kind and would
     * otherwise be five nullable columns that only ever apply to one of them.
     */
    config: jsonb("config"),
    ...timestamps,
  },
  (t) => [index("assignment_task_assignment_idx").on(t.assignmentId, t.position)],
);

/**
 * One learner's attempt at an assignment. Multiple rows per learner are
 * allowed (resubmission), distinguished by `attemptNumber`; the highest one is
 * the current attempt.
 */
export const submission = learnSchema.table(
  "submission",
  {
    id: id(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignment.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: submissionStatus("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** True when `submittedAt > assignment.dueAt`, frozen at submit time. */
    isLate: boolean("is_late").notNull().default(false),

    // ── Current grade ───────────────────────────────────────────────────────
    // The live values; every change also appends a `submission_grade` row so
    // a regrade never overwrites the record of the previous decision.
    score: integer("score"),
    maxScore: integer("max_score"),
    passed: boolean("passed"),
    feedback: jsonb("feedback"),
    feedbackText: text("feedback_text").notNull().default(""),
    gradedBy: text("graded_by").references(() => user.id, { onDelete: "set null" }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("submission_attempt_uq").on(t.assignmentId, t.userId, t.attemptNumber),
    index("submission_assignment_status_idx").on(t.assignmentId, t.status),
    index("submission_user_idx").on(t.userId),
  ],
);

/** The learner's answer to one task within a submission. */
export const submissionTask = learnSchema.table(
  "submission_task",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => assignmentTask.id, { onDelete: "cascade" }),
    /** kind=text: rich answer (TipTap JSON). */
    content: jsonb("content"),
    contentText: text("content_text").notNull().default(""),
    /** kind=file: the uploaded hand-in. */
    assetId: text("asset_id").references(() => courseAsset.id, { onDelete: "set null" }),
    /** kind=quiz: the attempt that answers this task. */
    quizAttemptId: text("quiz_attempt_id").references(() => quizAttempt.id, {
      onDelete: "set null",
    }),
    /** Per-task grade; the submission's score is their sum. */
    score: integer("score"),
    feedback: text("feedback"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("submission_task_uq").on(t.submissionId, t.taskId),
    index("submission_task_task_idx").on(t.taskId),
  ],
);

/**
 * Append-only history of grading decisions on one submission.
 *
 * A grade is a statement about a person that can be appealed, so the previous
 * value and who set it has to survive the regrade — the same reason
 * `wiki.page_revision` exists next to `wiki.page`.
 */
export const submissionGrade = learnSchema.table(
  "submission_grade",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    score: integer("score").notNull(),
    maxScore: integer("max_score").notNull(),
    passed: boolean("passed").notNull(),
    feedbackText: text("feedback_text").notNull().default(""),
    gradedBy: text("graded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("submission_grade_uq").on(t.submissionId, t.version)],
);
