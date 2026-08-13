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
  "comment.updated",
  "comment.resolved",
  "comment.deleted",
  // Access control. Who can see what is the question an audit log exists to
  // answer, and until these were recorded a grant could be added and removed
  // again between two reads of the members list with nothing left behind.
  "space.member_added",
  "space.member_role_changed",
  "space.member_removed",
  "page.access_changed",
  "page.member_added",
  "page.member_role_changed",
  "page.member_removed",
  "attachment.uploaded",
  "attachment.deleted",
  "organization.two_factor_enabled",
  "organization.two_factor_disabled",
  "organization.two_factor_grace_updated",
  // Auditable, but never delivered to a webhook — see `lib/webhooks/events.ts`.
  "webhook.created",
  "webhook.updated",
  "webhook.deleted",
  // Mirrored from the instance audit log so the impersonated account sees, in
  // its own feed, that somebody signed in as them. Carries no digest category —
  // `categoryForAction` drops it, which keeps it out of summary mails.
  "impersonation.started",
  "impersonation.ended",
  "retention.updated",
  "retention.purged",
  "hold.created",
  "hold.released",
  // Learning platform. Kept in lockstep with the pg enum in
  // `packages/db/src/schema/wiki/enums.ts` — a value added to one and not the
  // other either fails the insert or silently drops out of the API contract.
  "course.created",
  "course.updated",
  "course.published",
  "course.archived",
  "course.restored",
  "course.deleted",
  "course.untrashed",
  "course.purged",
  "course.member_added",
  "course.member_role_changed",
  "course.member_removed",
  "chapter.created",
  "chapter.updated",
  "chapter.moved",
  "chapter.deleted",
  "lesson.created",
  "lesson.updated",
  "lesson.published",
  "lesson.moved",
  "lesson.deleted",
  "collection.created",
  "collection.updated",
  "collection.deleted",
  "enrollment.created",
  "enrollment.approved",
  "enrollment.completed",
  "enrollment.dropped",
  "assignment.created",
  "assignment.updated",
  "assignment.deleted",
  "submission.submitted",
  "submission.graded",
  "submission.returned",
  "quiz.created",
  "quiz.updated",
  "quiz.deleted",
  "certificate.issued",
  "certificate.revoked",
]);

export const ActivitySchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  spaceId: IdSchema.nullable(),
  pageId: IdSchema.nullable(),
  courseId: IdSchema.nullable(),
  actorId: IdSchema.nullable(),
  /** The instance admin behind `actorId` when the row was written while impersonating. */
  impersonatedBy: IdSchema.nullable(),
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
