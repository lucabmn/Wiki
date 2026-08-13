import { z } from "zod";

import { IdSchema } from "./shared";

/**
 * Chapter and lesson contracts, plus the course outline — the one payload the
 * player, the builder and the progress rail all read.
 */

export const LessonKindSchema = z.enum([
  "dynamic",
  "video",
  "embed",
  "document",
  "assignment",
  "quiz",
]);
export type LessonKind = z.infer<typeof LessonKindSchema>;

export const ProgressStatusSchema = z.enum(["not_started", "in_progress", "completed"]);

// --- Chapters ---------------------------------------------------------------

export const ChapterSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  title: z.string(),
  description: z.string().nullable(),
  position: z.string(),
  availableFrom: z.date().nullable(),
  dripDelayDays: z.number().int().nullable(),
  publishedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateChapterInputSchema = z.object({
  courseId: IdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  /** Insert after this chapter; omit to append at the end. */
  afterChapterId: IdSchema.nullish(),
});

export const UpdateChapterInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  availableFrom: z.coerce.date().nullish(),
  dripDelayDays: z.number().int().min(0).max(3650).nullish(),
  published: z.boolean().optional(),
});

export const MoveChapterInputSchema = z.object({
  id: IdSchema,
  /** New predecessor. Null moves the chapter to the front. */
  afterChapterId: IdSchema.nullish(),
});

// --- Lessons ----------------------------------------------------------------

export const LessonSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  chapterId: IdSchema,
  kind: LessonKindSchema,
  title: z.string(),
  slug: z.string(),
  position: z.string(),
  content: z.unknown().nullable(),
  assetId: IdSchema.nullable(),
  /** Ready-to-use URL for the lesson's video or document, or null. */
  assetUrl: z.string().nullable(),
  embedUrl: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  isRequired: z.boolean(),
  autoCompleteAtPercent: z.number().int().nullable(),
  publishedAt: z.date().nullable(),
  createdBy: IdSchema.nullable(),
  lastEditedBy: IdSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateLessonInputSchema = z.object({
  chapterId: IdSchema,
  kind: LessonKindSchema.default("dynamic"),
  title: z.string().min(1).max(200),
  afterLessonId: IdSchema.nullish(),
});

export const UpdateLessonInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.unknown().nullish(),
  /** Plaintext projection of `content`, supplied by the editor for search. */
  textContent: z.string().max(2_000_000).optional(),
  assetId: IdSchema.nullish(),
  embedUrl: z.string().url().max(2000).nullish(),
  durationSeconds: z.number().int().min(0).max(86_400).nullish(),
  isRequired: z.boolean().optional(),
  autoCompleteAtPercent: z.number().int().min(1).max(100).nullish(),
});

export const MoveLessonInputSchema = z.object({
  id: IdSchema,
  /** The chapter to move into — omit to reorder within the current one. */
  chapterId: IdSchema.optional(),
  afterLessonId: IdSchema.nullish(),
});

// --- Outline ----------------------------------------------------------------

/**
 * One lesson as the player's sidebar shows it: enough to render the row and
 * decide whether it opens, and nothing of its body.
 */
export const OutlineLessonSchema = z.object({
  id: IdSchema,
  title: z.string(),
  slug: z.string(),
  kind: LessonKindSchema,
  position: z.string(),
  durationSeconds: z.number().int().nullable(),
  isRequired: z.boolean(),
  published: z.boolean(),
  status: ProgressStatusSchema,
  furthestPercent: z.number().int(),
  positionSeconds: z.number().int(),
  /**
   * Whether the learner may open it now, and why not when they may not. Decided
   * on the server: sequential courses and dripped chapters both gate here.
   */
  locked: z.boolean(),
  lockReason: z.enum(["none", "sequential", "drip", "not_enrolled"]),
  /** When a dripped chapter opens, so the UI can name a date. */
  availableAt: z.date().nullable(),
});

export const OutlineChapterSchema = z.object({
  id: IdSchema,
  title: z.string(),
  description: z.string().nullable(),
  position: z.string(),
  published: z.boolean(),
  locked: z.boolean(),
  availableAt: z.date().nullable(),
  lessons: z.array(OutlineLessonSchema),
});

export const CourseOutlineSchema = z.object({
  courseId: IdSchema,
  /** True when the caller is staff, so the builder can show drafts. */
  isStaff: z.boolean(),
  totalLessons: z.number().int(),
  requiredLessons: z.number().int(),
  completedLessons: z.number().int(),
  progressPercent: z.number().int(),
  /** Where "continue" should go, or null when nothing is open yet. */
  nextLessonId: IdSchema.nullable(),
  chapters: z.array(OutlineChapterSchema),
});
