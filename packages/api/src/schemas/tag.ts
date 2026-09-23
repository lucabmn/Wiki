import { z } from "zod";

import { HexColorSchema, IdSchema } from "./shared";

export const TagSchema = z.object({
  id: IdSchema,
  spaceId: IdSchema,
  name: z.string(),
  color: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Tag = z.infer<typeof TagSchema>;

export const TagWithCountSchema = TagSchema.extend({ pageCount: z.number().int().nonnegative() });
export type TagWithCount = z.infer<typeof TagWithCountSchema>;

export const TaggedPageSchema = z.object({
  pageId: IdSchema,
  spaceId: IdSchema,
  title: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  updatedAt: z.date(),
});
export type TaggedPage = z.infer<typeof TaggedPageSchema>;

export const ListTagsInputSchema = z.object({ spaceId: IdSchema });

export const ListPagesByTagInputSchema = z.object({
  tagId: IdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const CreateTagInputSchema = z.object({
  spaceId: IdSchema,
  name: z.string().trim().min(1).max(60),
  color: HexColorSchema.nullish(),
});

export const UpdateTagInputSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60).optional(),
  color: HexColorSchema.nullish(),
});

/** Attach/detach a tag to a page (join row). */
export const PageTagInputSchema = z.object({
  pageId: IdSchema,
  tagId: IdSchema,
});
