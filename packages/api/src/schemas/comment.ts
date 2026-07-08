import { z } from "zod";

import { IdSchema } from "./shared";

/** Optional editor anchor for inline/margin comments. Opaque JSON. */
const AnchorSchema = z.unknown();

export const CommentSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  parentId: IdSchema.nullable(),
  authorId: IdSchema.nullable(),
  body: z.string(),
  anchor: AnchorSchema.nullable(),
  resolvedAt: z.date().nullable(),
  resolvedBy: IdSchema.nullable(),
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const ListCommentsInputSchema = z.object({
  pageId: IdSchema,
  includeResolved: z.boolean().default(true),
});

export const CreateCommentInputSchema = z.object({
  pageId: IdSchema,
  parentId: IdSchema.nullish(),
  body: z.string().min(1).max(10_000),
  anchor: AnchorSchema.optional(),
});

export const UpdateCommentInputSchema = z.object({
  id: IdSchema,
  body: z.string().min(1).max(10_000),
});
