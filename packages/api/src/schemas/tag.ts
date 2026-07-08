import { z } from "zod";

import { IdSchema } from "./shared";

const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color");

export const TagSchema = z.object({
  id: IdSchema,
  spaceId: IdSchema,
  name: z.string(),
  color: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Tag = z.infer<typeof TagSchema>;

export const ListTagsInputSchema = z.object({ spaceId: IdSchema });

export const CreateTagInputSchema = z.object({
  spaceId: IdSchema,
  name: z.string().min(1).max(60),
  color: ColorSchema.nullish(),
});

export const UpdateTagInputSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60).optional(),
  color: ColorSchema.nullish(),
});

/** Attach/detach a tag to a page (join row). */
export const PageTagInputSchema = z.object({
  pageId: IdSchema,
  tagId: IdSchema,
});
