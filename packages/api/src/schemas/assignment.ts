import { z } from "zod";

import { IdSchema } from "./shared";

/**
 * Assignment and submission I/O contracts. Hand-written for the same reason as
 * the course ones: the wire format is a decision rather than a projection of the
 * table. Rich text travels as the editor's JSON *plus* the plaintext the client
 * derived from it — the server stores both, and nothing else about a hand-in
 * (grade history rows, storage keys) leaks through these shapes.
 */

export const AssignmentTaskKindSchema = z.enum(["file", "text", "quiz"]);
export const SubmissionStatusSchema = z.enum(["draft", "submitted", "returned", "graded"]);
export const GradingMethodSchema = z.enum(["auto", "manual"]);

// --- Assignments ------------------------------------------------------------

export const AssignmentTaskSchema = z.object({
  id: IdSchema,
  assignmentId: IdSchema,
  kind: AssignmentTaskKindSchema,
  title: z.string(),
  description: z.unknown().nullable(),
  position: z.string(),
  maxGrade: z.number().int(),
  quizId: IdSchema.nullable(),
  config: z.unknown().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const AssignmentSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  lessonId: IdSchema,
  title: z.string(),
  instructions: z.unknown().nullable(),
  instructionsText: z.string(),
  dueAt: z.date().nullable(),
  /** Derived: always the sum of the tasks' `maxGrade`. */
  maxGrade: z.number().int(),
  passingGrade: z.number().int(),
  gradingMethod: GradingMethodSchema,
  allowLateSubmission: z.boolean(),
  maxAttempts: z.number().int().nullable(),
  blindGrading: z.boolean(),
  publishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * The brief with everything an author edits. Task writes answer with this shape
 * because `maxGrade` is derived — a client that only got the task back would
 * hold a stale total.
 */
export const AssignmentWithTasksSchema = AssignmentSchema.extend({
  tasks: z.array(AssignmentTaskSchema),
});

// --- Submissions ------------------------------------------------------------

export const SubmissionTaskSchema = z.object({
  id: IdSchema,
  submissionId: IdSchema,
  taskId: IdSchema,
  content: z.unknown().nullable(),
  contentText: z.string(),
  assetId: IdSchema.nullable(),
  quizAttemptId: IdSchema.nullable(),
  score: z.number().int().nullable(),
  feedback: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SubmissionSchema = z.object({
  id: IdSchema,
  assignmentId: IdSchema,
  userId: IdSchema,
  attemptNumber: z.number().int(),
  status: SubmissionStatusSchema,
  submittedAt: z.date().nullable(),
  isLate: z.boolean(),
  score: z.number().int().nullable(),
  maxScore: z.number().int().nullable(),
  passed: z.boolean().nullable(),
  feedback: z.unknown().nullable(),
  feedbackText: z.string(),
  gradedBy: IdSchema.nullable(),
  gradedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SubmissionDetailSchema = SubmissionSchema.extend({
  tasks: z.array(SubmissionTaskSchema),
});

/** What the assignment page shows about the caller's own latest attempt. */
export const SubmissionSummarySchema = SubmissionSchema.pick({
  id: true,
  attemptNumber: true,
  status: true,
  submittedAt: true,
  isLate: true,
  score: true,
  maxScore: true,
  passed: true,
  gradedAt: true,
});

/**
 * One row of the grading queue.
 *
 * `userId` is nullable here and nowhere else: under `blindGrading` the
 * submitter's identity is withheld until a grade exists, and a schema that kept
 * the id while dropping the name would hand the grader the same information one
 * join later.
 */
export const SubmissionListItemSchema = SubmissionSchema.extend({
  userId: IdSchema.nullable(),
  user: z.object({ id: IdSchema, name: z.string(), image: z.string().nullable() }).nullable(),
});

/** The assignment as a learner or a member of staff opens it. */
export const AssignmentDetailSchema = AssignmentWithTasksSchema.extend({
  mySubmission: SubmissionSummarySchema.nullable(),
});

// --- Inputs -----------------------------------------------------------------

export const CreateAssignmentInputSchema = z.object({
  lessonId: IdSchema,
  title: z.string().min(1).max(200),
  instructions: z.unknown().nullish(),
  instructionsText: z.string().max(500_000).optional(),
  dueAt: z.coerce.date().nullish(),
  passingGrade: z.number().int().min(0).max(1_000_000).optional(),
  gradingMethod: GradingMethodSchema.default("manual"),
  allowLateSubmission: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(100).nullish(),
  blindGrading: z.boolean().default(false),
});

export const UpdateAssignmentInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  instructions: z.unknown().nullish(),
  instructionsText: z.string().max(500_000).optional(),
  dueAt: z.coerce.date().nullish(),
  passingGrade: z.number().int().min(0).max(1_000_000).optional(),
  gradingMethod: GradingMethodSchema.optional(),
  allowLateSubmission: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(100).nullish(),
  blindGrading: z.boolean().optional(),
});

export const AddAssignmentTaskInputSchema = z.object({
  /** The assignment this task is appended to. */
  id: IdSchema,
  kind: AssignmentTaskKindSchema.default("text"),
  title: z.string().min(1).max(200),
  description: z.unknown().nullish(),
  maxGrade: z.number().int().min(0).max(1_000_000).default(100),
  /** Required for `kind: "quiz"`, and must belong to the same course. */
  quizId: IdSchema.nullish(),
  config: z.unknown().nullish(),
});

export const UpdateAssignmentTaskInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  description: z.unknown().nullish(),
  maxGrade: z.number().int().min(0).max(1_000_000).optional(),
  quizId: IdSchema.nullish(),
  config: z.unknown().nullish(),
});

export const MoveAssignmentTaskInputSchema = z.object({
  id: IdSchema,
  /** Place the task after this sibling; omit or null to move it first. */
  afterTaskId: IdSchema.nullish(),
});

export const ListMySubmissionsInputSchema = z.object({
  assignmentId: IdSchema,
});

export const ListSubmissionsInputSchema = z.object({
  assignmentId: IdSchema,
  /**
   * `draft` is deliberately absent: a hand-in nobody has handed in is the
   * learner's own workspace, so the grading queue cannot even ask for it.
   */
  status: z.enum(["submitted", "returned", "graded"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const StartSubmissionInputSchema = z.object({
  assignmentId: IdSchema,
});

export const SaveSubmissionTaskInputSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  content: z.unknown().nullish(),
  contentText: z.string().max(500_000).optional(),
  assetId: IdSchema.nullish(),
  quizAttemptId: IdSchema.nullish(),
});

export const GradeSubmissionInputSchema = z.object({
  id: IdSchema,
  /** Per-task scores. Tasks left out keep whatever score they already carry. */
  tasks: z
    .array(
      z.object({
        taskId: IdSchema,
        score: z.number().int().min(0).max(1_000_000),
        feedback: z.string().max(10_000).nullish(),
      }),
    )
    .max(100)
    .default([]),
  feedback: z.unknown().nullish(),
  feedbackText: z.string().max(50_000).optional(),
});

export const ReturnSubmissionInputSchema = z.object({
  id: IdSchema,
  feedback: z.unknown().nullish(),
  feedbackText: z.string().max(50_000).optional(),
});
