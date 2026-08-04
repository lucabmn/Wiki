import { z } from "zod";

import { IdSchema } from "./shared";

/**
 * Shapes for the instance-admin console.
 *
 * Everything here is **metadata only** — no page content, no comment bodies. An
 * instance admin operates the deployment; reading what people wrote requires
 * impersonation, and that leaves an audit trail. The difference between "the
 * admin can read along" and "the admin read along and it is provable" is the
 * whole point, so the console must not quietly offer the first.
 */

// --- Users ---------------------------------------------------------------

export const AdminUserSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  /** Instance role (`auth.user.role`), already split — not an org role. */
  roles: z.array(z.string()),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  banExpires: z.date().nullable(),
  createdAt: z.date(),
  organizationCount: z.number().int(),
  activeSessionCount: z.number().int(),
  lastSeenAt: z.date().nullable(),
});

export const AdminUserOrganizationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string().nullable(),
  /** The member row's comma-separated org roles, split. */
  roles: z.array(z.string()),
  joinedAt: z.date(),
});

export const AdminUserDetailSchema = AdminUserSummarySchema.extend({
  twoFactorEnabled: z.boolean(),
  passkeyCount: z.number().int(),
  /** Sign-in methods on the account: `credential`, `google`, an SSO provider id … */
  providers: z.array(z.string()),
  organizations: z.array(AdminUserOrganizationSchema),
});

export const AdminSessionSchema = z.object({
  id: IdSchema,
  /** Needed to revoke exactly this session; never rendered. */
  token: z.string(),
  createdAt: z.date(),
  expiresAt: z.date(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Set when this session is itself an impersonation. */
  impersonatedBy: z.string().nullable(),
  /** True for the session making the request — the one you must not revoke blindly. */
  current: z.boolean(),
});

// --- Organizations -------------------------------------------------------

export const AdminOrganizationSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string().nullable(),
  logo: z.string().nullable(),
  createdAt: z.date(),
  memberCount: z.number().int(),
  spaceCount: z.number().int(),
  pageCount: z.number().int(),
  /** Sum of attachment sizes, in bytes. */
  storageBytes: z.number().int(),
});

/** A space as the console shows it: name, size, activity — never its pages' text. */
export const AdminSpaceSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string(),
  visibility: z.string(),
  archivedAt: z.date().nullable(),
  pageCount: z.number().int(),
  storageBytes: z.number().int(),
  updatedAt: z.date(),
});

export const AdminOrganizationDetailSchema = AdminOrganizationSummarySchema.extend({
  owners: z.array(z.object({ id: IdSchema, name: z.string(), email: z.string() })),
  spaces: z.array(AdminSpaceSummarySchema),
});

// --- Instance overview ---------------------------------------------------

export const InstanceOverviewSchema = z.object({
  version: z.string(),
  counts: z.object({
    users: z.number().int(),
    bannedUsers: z.number().int(),
    admins: z.number().int(),
    organizations: z.number().int(),
    spaces: z.number().int(),
    pages: z.number().int(),
    activeSessions: z.number().int(),
  }),
  storage: z.object({
    configured: z.boolean(),
    /** Bucket name, or null when object storage is not set up. */
    bucket: z.string().nullable(),
    usedBytes: z.number().int(),
  }),
  mail: z.object({ configured: z.boolean(), host: z.string().nullable() }),
  collab: z.object({ reachable: z.boolean(), url: z.string() }),
  impersonation: z.object({ enabled: z.boolean(), maxMinutes: z.number().int() }),
});

// --- Audit ---------------------------------------------------------------

export const AdminAuditActionSchema = z.enum([
  "user.created",
  "user.role_changed",
  "user.banned",
  "user.unbanned",
  "user.deleted",
  "user.password_set",
  "user.password_reset_requested",
  "session.revoked",
  "session.revoked_all",
  "impersonation.started",
  "impersonation.ended",
]);

export const AdminAuditEntrySchema = z.object({
  id: IdSchema,
  action: AdminAuditActionSchema,
  actorId: IdSchema.nullable(),
  actorEmail: z.string().nullable(),
  actorName: z.string().nullable(),
  targetUserId: IdSchema.nullable(),
  targetEmail: z.string().nullable(),
  targetName: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.date(),
});

// --- Inputs --------------------------------------------------------------

const PaginationInput = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

export const ListAdminUsersInputSchema = z.object({
  /** Matches name or email, case-insensitively. */
  query: z.string().max(200).optional(),
  filter: z.enum(["all", "admins", "banned"]).default("all"),
  ...PaginationInput,
});

export const ListAdminOrganizationsInputSchema = z.object({
  query: z.string().max(200).optional(),
  ...PaginationInput,
});

export const ListAdminAuditInputSchema = z.object({
  targetUserId: IdSchema.optional(),
  action: AdminAuditActionSchema.optional(),
  ...PaginationInput,
});

export const AdminUserRefSchema = z.object({ userId: IdSchema });
export const AdminOrgRefSchema = z.object({ organizationId: IdSchema });

export const SetInstanceRoleInputSchema = z.object({
  userId: IdSchema,
  /** `admin` grants the console; `user` is the ordinary account role. */
  role: z.enum(["admin", "user"]),
});

export const BanUserInputSchema = z.object({
  userId: IdSchema,
  reason: z.string().min(1).max(500),
  /** Omitted = permanent, until an admin lifts it. */
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export const RevokeSessionInputSchema = z.object({
  userId: IdSchema,
  sessionToken: z.string().min(1),
});

/** Every mutation answers with the same shape so the client can stay generic. */
export const AdminActionResultSchema = z.object({ success: z.literal(true) });
