import { z } from "zod";

import { IdSchema } from "./shared";

const RetentionDaysSchema = z.coerce.number().int().min(1).max(3650);

/**
 * `auditRetentionDays: null` is "keep forever" and is the default. It is
 * nullable rather than a sentinel number so no arithmetic can ever turn
 * "unlimited" into "zero days".
 */
export const RetentionPolicySchema = z.object({
  auditRetentionDays: RetentionDaysSchema.nullable(),
  trashRetentionDays: RetentionDaysSchema,
});

export const RetentionSettingsSchema = RetentionPolicySchema.extend({
  lastPurgeAt: z.date().nullable(),
});

export const UpdateRetentionInputSchema = RetentionPolicySchema;

/** Upper bound on what the next run would remove; drives the confirm dialog. */
export const RetentionImpactSchema = z.object({
  auditRows: z.number().int(),
  trashedPages: z.number().int(),
  trashedSpaces: z.number().int(),
});

export const PreviewRetentionInputSchema = RetentionPolicySchema;

// ── Legal hold ──────────────────────────────────────────────────────────────

export const LegalHoldSubjectSchema = z.enum(["organization", "space", "page"]);

export const LegalHoldSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  subject: LegalHoldSubjectSchema,
  subjectId: IdSchema,
  reason: z.string(),
  createdBy: IdSchema.nullable(),
  releasedAt: z.date().nullable(),
  releasedBy: IdSchema.nullable(),
  releaseReason: z.string().nullable(),
  createdAt: z.date(),
  /** Resolved label of the held object, so a list needs no second round-trip. */
  subjectLabel: z.string().nullable(),
});

export const ListLegalHoldsInputSchema = z.object({
  /** Released holds are history and hidden unless explicitly asked for. */
  includeReleased: z.boolean().default(false),
  subjectId: IdSchema.optional(),
});

export const CreateLegalHoldInputSchema = z.object({
  subject: LegalHoldSubjectSchema,
  /** Omitted for `organization`, where the active org is the subject. */
  subjectId: IdSchema.optional(),
  // A hold without a stated reason is unauditable: months later nobody can say
  // whether it still applies, so it never gets released.
  reason: z.string().trim().min(3).max(2000),
});

export const ReleaseLegalHoldInputSchema = z.object({
  id: IdSchema,
  // Releasing is its own event with its own justification — the whole point of a
  // block is that lifting it leaves a trace.
  reason: z.string().trim().min(3).max(2000),
});

/** Whether a given object is currently blocked, and why. Drives the UI badge. */
export const HoldStatusSchema = z.object({
  held: z.boolean(),
  /** Where the block comes from: the object itself, its space, or the org. */
  source: z.enum(["none", "page", "space", "organization"]),
  reason: z.string().nullable(),
  holdId: IdSchema.nullable(),
});

export const HoldStatusInputSchema = z
  .object({
    pageId: IdSchema.optional(),
    spaceId: IdSchema.optional(),
  })
  .refine((value) => !!value.pageId !== !!value.spaceId, {
    message: "Provide exactly one of pageId or spaceId",
  });

// ── Trash ───────────────────────────────────────────────────────────────────

const TrashEntryBase = {
  id: IdSchema,
  title: z.string(),
  deletedAt: z.date(),
  deletedBy: IdSchema.nullable(),
  /** When the purge runner will remove it for good. */
  expiresAt: z.date(),
  /** True when a deletion block keeps it alive past `expiresAt`. */
  held: z.boolean(),
};

export const TrashedPageSchema = z.object({
  ...TrashEntryBase,
  spaceId: IdSchema,
  icon: z.string().nullable(),
  /** Set when the page was archived before it was deleted; restore puts it back. */
  archivedAt: z.date().nullable(),
});

export const TrashedSpaceSchema = z.object({
  ...TrashEntryBase,
  slug: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  pageCount: z.number().int(),
});

export const ListTrashedPagesInputSchema = z.object({ spaceId: IdSchema });
