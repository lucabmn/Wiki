import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../_helpers";
import { user } from "../auth";
import { learnSchema } from "./_schema";
import { lesson } from "./chapters";
import { course } from "./courses";
import { quizAnswerReveal, quizQuestionKind } from "./enums";

/**
 * A graded questionnaire. A quiz is owned by a course and referenced from
 * whatever uses it — a `lesson` of kind `quiz`, or an `assignment_task` of kind
 * `quiz`. Modelling it as its own entity rather than as lesson columns is what
 * lets the same quiz be both a practice lesson and part of a hand-in.
 */
export const quiz = learnSchema.table(
  "quiz",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** Percent of the total points needed to pass. */
    passingPercent: integer("passing_percent").notNull().default(70),
    /** `null` = unlimited retakes. */
    maxAttempts: integer("max_attempts"),
    /** `null` = untimed. Enforced server-side on submit, not by the browser. */
    timeLimitMinutes: integer("time_limit_minutes"),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    shuffleOptions: boolean("shuffle_options").notNull().default(false),
    answerReveal: quizAnswerReveal("answer_reveal").notNull().default("after_attempt"),
    ...timestamps,
  },
  (t) => [index("quiz_course_idx").on(t.courseId)],
);

export const quizQuestion = learnSchema.table(
  "quiz_question",
  {
    id: id(),
    quizId: text("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "cascade" }),
    kind: quizQuestionKind("kind").notNull().default("single_choice"),
    /** Rich prompt (TipTap JSON) so a question can carry code or an image. */
    prompt: jsonb("prompt"),
    promptText: text("prompt_text").notNull().default(""),
    /** Shown after the attempt, per `quiz.answerReveal`. */
    explanation: text("explanation"),
    points: integer("points").notNull().default(1),
    position: text("position").notNull().default("a0"),
    /**
     * kind=short_answer: the accepted answers, compared case-insensitively
     * after trimming. Ignored for the choice kinds, which use `quiz_option`.
     */
    acceptedAnswers: jsonb("accepted_answers"),
    ...timestamps,
  },
  (t) => [index("quiz_question_quiz_idx").on(t.quizId, t.position)],
);

export const quizOption = learnSchema.table(
  "quiz_option",
  {
    id: id(),
    questionId: text("question_id")
      .notNull()
      .references(() => quizQuestion.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
    position: text("position").notNull().default("a0"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("quiz_option_question_idx").on(t.questionId, t.position)],
);

/**
 * One run at a quiz. Rows are created on start (not on submit) so a timed quiz
 * has a server-side clock and an abandoned attempt still counts against
 * `maxAttempts`.
 */
export const quizAttempt = learnSchema.table(
  "quiz_attempt",
  {
    id: id(),
    quizId: text("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Set when the quiz was taken as a lesson; null inside an assignment. */
    lessonId: text("lesson_id").references(() => lesson.id, { onDelete: "set null" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Points scored / points available, frozen at submit time. */
    score: integer("score").notNull().default(0),
    maxScore: integer("max_score").notNull().default(0),
    passed: boolean("passed").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("quiz_attempt_uq").on(t.quizId, t.userId, t.attemptNumber),
    index("quiz_attempt_user_idx").on(t.userId),
    index("quiz_attempt_quiz_idx").on(t.quizId),
  ],
);

export const quizResponse = learnSchema.table(
  "quiz_response",
  {
    id: id(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => quizAttempt.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => quizQuestion.id, { onDelete: "cascade" }),
    /** Chosen option ids, as a JSON array — one for single choice, n for multi. */
    selectedOptionIds: jsonb("selected_option_ids"),
    /** kind=short_answer: what the learner typed, verbatim. */
    textAnswer: text("text_answer"),
    isCorrect: boolean("is_correct").notNull().default(false),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("quiz_response_uq").on(t.attemptId, t.questionId)],
);
