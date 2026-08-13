import { z } from "zod";

import { IdSchema } from "./shared";

/**
 * Quiz I/O contracts. Hand-written like the course ones, but here the wire
 * format carries a security rule rather than just a preference: `isCorrect` and
 * `acceptedAnswers` are the answer key, and a learner must never receive them
 * before their attempt has been scored.
 *
 * That rule is enforced by *shape*, not by filtering. There are two projections
 * of a question — {@link StaffQuestionSchema} and {@link LearnerQuestionSchema}
 * — and the learner one has no answer-key key at all, so a handler that forgot
 * to strip it fails output validation instead of leaking. The discriminated
 * union below is what makes the two branches distinguishable to the client and
 * to the OpenAPI generator.
 */

export const QuizQuestionKindSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
]);
export const QuizAnswerRevealSchema = z.enum(["never", "after_attempt", "after_pass"]);

// --- Quiz --------------------------------------------------------------------

export const QuizSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  title: z.string(),
  description: z.string().nullable(),
  passingPercent: z.number().int(),
  /** null = unlimited retakes. */
  maxAttempts: z.number().int().nullable(),
  /** null = untimed. Enforced on submit, server-side. */
  timeLimitMinutes: z.number().int().nullable(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  answerReveal: QuizAnswerRevealSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Quiz = z.infer<typeof QuizSchema>;

// --- Options -----------------------------------------------------------------

/** An option as the learner sees it: the label, and nothing that gives it away. */
export const LearnerOptionSchema = z.object({
  id: IdSchema,
  questionId: IdSchema,
  label: z.string(),
  position: z.string(),
});

/** The same option with the answer key attached. Staff and post-reveal only. */
export const StaffOptionSchema = LearnerOptionSchema.extend({
  isCorrect: z.boolean(),
  createdAt: z.date(),
});

// --- Questions ---------------------------------------------------------------

const questionBase = {
  id: IdSchema,
  quizId: IdSchema,
  kind: QuizQuestionKindSchema,
  /** Rich prompt (TipTap JSON), so a question can carry code or an image. */
  prompt: z.unknown().nullable(),
  promptText: z.string(),
  points: z.number().int(),
  position: z.string(),
};

export const LearnerQuestionSchema = z.object({
  ...questionBase,
  options: z.array(LearnerOptionSchema),
});
export type LearnerQuestion = z.infer<typeof LearnerQuestionSchema>;

export const StaffQuestionSchema = z.object({
  ...questionBase,
  options: z.array(StaffOptionSchema),
  /**
   * Says *why* an answer is right, so it is part of the answer key and lives
   * only on this projection — never on {@link LearnerQuestionSchema}.
   */
  explanation: z.string().nullable(),
  /** kind=short_answer: every spelling the author accepts. */
  acceptedAnswers: z.unknown().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type StaffQuestion = z.infer<typeof StaffQuestionSchema>;

/**
 * A quiz plus its questions, in one of two mutually exclusive projections.
 * `view` is an explicit discriminator: a bare union would let zod validate a
 * staff payload against the learner branch and silently strip it — or worse,
 * the other way round — and the client could not tell which it received.
 */
export const QuizDetailSchema = z.discriminatedUnion("view", [
  z.object({
    view: z.literal("full"),
    quiz: QuizSchema,
    questions: z.array(StaffQuestionSchema),
  }),
  z.object({
    view: z.literal("redacted"),
    quiz: QuizSchema,
    questions: z.array(LearnerQuestionSchema),
  }),
]);

// --- Attempts ----------------------------------------------------------------

export const QuizAttemptSchema = z.object({
  id: IdSchema,
  quizId: IdSchema,
  userId: IdSchema,
  lessonId: IdSchema.nullable(),
  attemptNumber: z.number().int(),
  startedAt: z.date(),
  submittedAt: z.date().nullable(),
  score: z.number().int(),
  maxScore: z.number().int(),
  passed: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type QuizAttempt = z.infer<typeof QuizAttemptSchema>;

/** What the learner answered, with no verdict attached. */
export const LearnerResponseSchema = z.object({
  id: IdSchema,
  attemptId: IdSchema,
  questionId: IdSchema,
  selectedOptionIds: z.array(IdSchema),
  textAnswer: z.string().nullable(),
  createdAt: z.date(),
});

/**
 * The same answer with the verdict. Per-question correctness is the answer key
 * restated from the learner's side — "the option you picked was right" names
 * the right option — so it travels with the reveal decision, not with the
 * attempt. Without the split, a quiz set to `never` could be brute-forced in a
 * handful of retakes.
 */
export const StaffResponseSchema = LearnerResponseSchema.extend({
  isCorrect: z.boolean(),
  pointsAwarded: z.number().int(),
});

/**
 * A started attempt. The questions come back in the learner projection even for
 * staff taking their own quiz — starting an attempt is a learner act, and the
 * answer key has no business travelling with it.
 */
export const StartAttemptResultSchema = z.object({
  attempt: QuizAttemptSchema,
  quiz: QuizSchema,
  /** Already shuffled if the quiz asks for it — the order is decided server-side. */
  questions: z.array(LearnerQuestionSchema),
  /** Absolute deadline derived from `startedAt`, or null when untimed. */
  deadline: z.date().nullable(),
});

/**
 * A scored attempt. Both the questions and the responses carry the answer key
 * only when `quiz.answerReveal` permits it for this caller, which is why the
 * projections reappear here rather than being resolved by the client.
 *
 * The attempt's own `score` / `maxScore` / `passed` are in both branches on
 * purpose: a total says how many answers were right, never which — and seeing
 * one's own result is the whole point of being graded.
 */
export const AttemptDetailSchema = z.discriminatedUnion("view", [
  z.object({
    view: z.literal("full"),
    attempt: QuizAttemptSchema,
    quiz: QuizSchema,
    questions: z.array(StaffQuestionSchema),
    responses: z.array(StaffResponseSchema),
  }),
  z.object({
    view: z.literal("redacted"),
    attempt: QuizAttemptSchema,
    quiz: QuizSchema,
    questions: z.array(LearnerQuestionSchema),
    responses: z.array(LearnerResponseSchema),
  }),
]);

/** An attempt in a grader's list, with the learner attached. */
export const QuizAttemptRowSchema = QuizAttemptSchema.extend({
  user: z.object({ id: IdSchema, name: z.string(), image: z.string().nullable() }).nullable(),
});

// --- Inputs ------------------------------------------------------------------

export const CreateQuizInputSchema = z.object({
  courseId: IdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  passingPercent: z.number().int().min(0).max(100).default(70),
  maxAttempts: z.number().int().min(1).max(1000).nullish(),
  timeLimitMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullish(),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  answerReveal: QuizAnswerRevealSchema.default("after_attempt"),
});

export const UpdateQuizInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  passingPercent: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).max(1000).nullish(),
  timeLimitMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .nullish(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  answerReveal: QuizAnswerRevealSchema.optional(),
});

export const AddQuestionInputSchema = z.object({
  quizId: IdSchema,
  kind: QuizQuestionKindSchema.default("single_choice"),
  prompt: z.unknown().nullish(),
  promptText: z.string().max(10_000).default(""),
  explanation: z.string().max(4000).nullish(),
  points: z.number().int().min(0).max(1000).default(1),
  acceptedAnswers: z.array(z.string().min(1).max(500)).max(50).nullish(),
  /** Options can be created with the question so a one-call authoring flow works. */
  options: z
    .array(z.object({ label: z.string().min(1).max(500), isCorrect: z.boolean().default(false) }))
    .max(50)
    .optional(),
});

export const UpdateQuestionInputSchema = z.object({
  id: IdSchema,
  kind: QuizQuestionKindSchema.optional(),
  prompt: z.unknown().nullish(),
  promptText: z.string().max(10_000).optional(),
  explanation: z.string().max(4000).nullish(),
  points: z.number().int().min(0).max(1000).optional(),
  acceptedAnswers: z.array(z.string().min(1).max(500)).max(50).nullish(),
});

export const MoveQuestionInputSchema = z
  .object({
    id: IdSchema,
    // Reorder relative to a sibling question; provide at most one.
    beforeId: IdSchema.optional(),
    afterId: IdSchema.optional(),
  })
  .refine((v) => !(v.beforeId && v.afterId), {
    message: "provide beforeId or afterId, not both",
  });

export const AddOptionInputSchema = z.object({
  questionId: IdSchema,
  label: z.string().min(1).max(500),
  isCorrect: z.boolean().default(false),
});

export const UpdateOptionInputSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(500).optional(),
  isCorrect: z.boolean().optional(),
});

export const StartAttemptInputSchema = z.object({
  id: IdSchema,
  /** Set when the quiz is being taken as a lesson, so progress can be attributed. */
  lessonId: IdSchema.nullish(),
});

export const SubmitAttemptInputSchema = z.object({
  id: IdSchema,
  responses: z
    .array(
      z.object({
        questionId: IdSchema,
        selectedOptionIds: z.array(IdSchema).max(50).optional(),
        textAnswer: z.string().max(5000).nullish(),
      }),
    )
    .max(500),
});

export const ListAttemptsInputSchema = z.object({
  /**
   * The quiz id. Named `id` rather than `quizId` because it fills the `{id}`
   * placeholder that `POST /quizzes/{id}/attempts` already established — two
   * spellings of the same path template are not a valid OpenAPI document.
   */
  id: IdSchema,
  /** Narrow to one learner; omit for the whole cohort. */
  userId: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
