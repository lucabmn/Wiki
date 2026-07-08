import { z } from "zod";

import { IdSchema } from "./shared";

// --- Links / backlinks ---------------------------------------------------

export const PageLinkSchema = z.object({
  id: IdSchema,
  sourcePageId: IdSchema,
  targetPageId: IdSchema,
  createdAt: z.date(),
});

// --- Activity feed -------------------------------------------------------

export const ActivityActionSchema = z.enum([
  "space.created",
  "space.updated",
  "space.archived",
  "page.created",
  "page.updated",
  "page.published",
  "page.moved",
  "page.archived",
  "page.restored",
  "page.deleted",
  "comment.created",
  "comment.resolved",
  "attachment.uploaded",
]);

export const ActivitySchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  spaceId: IdSchema.nullable(),
  pageId: IdSchema.nullable(),
  actorId: IdSchema.nullable(),
  action: ActivityActionSchema,
  metadata: z.unknown().nullable(),
  createdAt: z.date(),
});

export const ListActivityInputSchema = z.object({
  spaceId: IdSchema.optional(),
  pageId: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Search --------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  spaceId: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const SearchHitSchema = z.object({
  pageId: IdSchema,
  spaceId: IdSchema,
  title: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  snippet: z.string(),
  rank: z.number(),
});
