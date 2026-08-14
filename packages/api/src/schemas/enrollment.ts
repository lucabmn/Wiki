import { z } from "zod";

import { IdSchema } from "./shared";

export const EnrollmentStatusSchema = z.enum(["pending", "active", "completed", "dropped"]);
export const EnrollmentSourceSchema = z.enum(["self", "invite", "purchase", "import"]);

export const EnrollmentSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  userId: IdSchema,
  status: EnrollmentStatusSchema,
  source: EnrollmentSourceSchema,
  invitedBy: IdSchema.nullable(),
  progressPercent: z.number().int(),
  lastLessonId: IdSchema.nullable(),
  lastActivityAt: z.date().nullable(),
  enrolledAt: z.date(),
  completedAt: z.date().nullable(),
  droppedAt: z.date().nullable(),
});

/** An enrolment as an instructor's roster shows it: who, not just which id. */
export const RosterEntrySchema = EnrollmentSchema.extend({
  user: z
    .object({
      id: IdSchema,
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
    })
    .nullable(),
  completedLessons: z.number().int(),
  totalLessons: z.number().int(),
});

export const EnrollInputSchema = z.object({ courseId: IdSchema });

export const ListRosterInputSchema = z.object({
  courseId: IdSchema,
  status: EnrollmentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const InviteLearnersInputSchema = z.object({
  courseId: IdSchema,
  userIds: z.array(IdSchema).min(1).max(200),
});

export const DecideEnrollmentInputSchema = z.object({
  id: IdSchema,
  approve: z.boolean(),
});

export const RemoveEnrollmentInputSchema = z.object({ id: IdSchema });

// --- Progress ---------------------------------------------------------------

export const LessonProgressSchema = z.object({
  id: IdSchema,
  enrollmentId: IdSchema,
  lessonId: IdSchema,
  status: z.enum(["not_started", "in_progress", "completed"]),
  positionSeconds: z.number().int(),
  furthestPercent: z.number().int(),
  secondsSpent: z.number().int(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});

/** What the player reports back while a lesson is open. */
export const TrackProgressInputSchema = z.object({
  lessonId: IdSchema,
  /** Resume point: seconds for video, scroll percent mapped to seconds for text. */
  positionSeconds: z.number().int().min(0).max(86_400).optional(),
  /** Furthest point reached, 0..100. Never regresses server-side. */
  furthestPercent: z.number().int().min(0).max(100).optional(),
  /** Seconds to add to the running total since the last report. */
  secondsSpent: z.number().int().min(0).max(3600).optional(),
});

export const CompleteLessonInputSchema = z.object({
  lessonId: IdSchema,
  completed: z.boolean().default(true),
});

/** The answer to "did that finish the course?", so the UI can celebrate once. */
export const ProgressResultSchema = z.object({
  progress: LessonProgressSchema,
  courseProgressPercent: z.number().int(),
  courseCompleted: z.boolean(),
  certificateId: IdSchema.nullable(),
});
