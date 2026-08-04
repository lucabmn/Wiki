import { z } from "zod";

import { IdSchema } from "./shared";

// --- Activity feed -------------------------------------------------------

export const ActivityActionSchema = z.enum([
  "space.created",
  "space.updated",
  "space.archived",
  "space.restored",
  "space.deleted",
  "space.untrashed",
  "space.purged",
  "page.created",
  "page.updated",
  "page.published",
  "page.moved",
  "page.archived",
  "page.restored",
  "page.deleted",
  "page.untrashed",
  "page.purged",
  "comment.created",
  "comment.resolved",
  "comment.deleted",
  "attachment.uploaded",
  "attachment.deleted",
  "retention.updated",
  "retention.purged",
  "hold.created",
  "hold.released",
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
  actor: z
    .object({
      name: z.string(),
    })
    .nullable(),
  space: z
    .object({
      name: z.string(),
      color: z.string().nullable(),
    })
    .nullable(),
});

export const ListActivityInputSchema = z.object({
  spaceId: IdSchema.optional(),
  pageId: IdSchema.optional(),
  /** Narrows the feed to one actor — powers the "activity" tab on a profile. */
  actorId: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Dashboard -----------------------------------------------------------

// Aggregate counts for the dashboard hero, all scoped to spaces the caller may
// read. Each headline value carries a "this week" companion so the sub-lines
// render real numbers instead of mock deltas.
export const DashboardOverviewSchema = z.object({
  pageCount: z.number().int(),
  pagesCreatedThisWeek: z.number().int(),
  openComments: z.number().int(),
  commentsResolvedThisWeek: z.number().int(),
  activeMembersThisWeek: z.number().int(),
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
