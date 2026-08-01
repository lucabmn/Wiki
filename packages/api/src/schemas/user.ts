import { z } from "zod";

import { PageStatusSchema } from "./page";
import { IdSchema } from "./shared";

// --- Directory / profile -------------------------------------------------

/** A member of the active organization, as shown in the people directory. */
export const UserSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  /** The member row's comma-separated role list, already split. */
  roles: z.array(z.string()),
  /** When the user joined *this* organization (not when the account was made). */
  joinedAt: z.date(),
});

/**
 * Contribution counts for one member. Every number is scoped to the spaces the
 * *caller* may read, so two people can legitimately see different totals for
 * the same profile.
 */
export const UserStatsSchema = z.object({
  pagesCreated: z.number().int(),
  pagesEdited: z.number().int(),
  comments: z.number().int(),
  /** Distinct spaces the user has authored a page in. */
  spacesContributed: z.number().int(),
  /** Timestamp of their most recent feed event, or null if they have none. */
  lastActiveAt: z.date().nullable(),
});

export const UserProfileSchema = UserSummarySchema.extend({
  /** When the account itself was created. */
  createdAt: z.date(),
  stats: UserStatsSchema,
});

/**
 * A page a user touched, trimmed to what a profile list renders. Deliberately
 * not `PageSchema`: that carries the full ProseMirror document, and a profile
 * ships dozens of rows.
 */
export const UserPageSchema = z.object({
  id: IdSchema,
  title: z.string(),
  icon: z.string().nullable(),
  status: PageStatusSchema,
  spaceId: IdSchema,
  spaceName: z.string(),
  spaceColor: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// --- Inputs --------------------------------------------------------------

export const UserRefInputSchema = z.object({ userId: IdSchema });

export const ListUserPagesInputSchema = z.object({
  userId: IdSchema,
  /** `created` filters on authorship, `edited` on the last editor. */
  kind: z.enum(["created", "edited"]).default("created"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
