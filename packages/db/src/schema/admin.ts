import { index, jsonb, pgSchema, text } from "drizzle-orm/pg-core";

import { id, timestamps } from "./_helpers";
import { user } from "./auth";

/**
 * Instance-wide administration events live in their own Postgres schema.
 *
 * They deliberately do **not** go into `wiki.activity`. That table is
 * org-scoped — `organization_id` is `NOT NULL` and every reader filters on it,
 * because an org admin may read their own organization's feed. Instance events
 * (a ban, a role change, an impersonation) belong to no organization, and org
 * admins must not see them at all. Two logs with disjoint audiences.
 *
 * The alternative — making `activity.organization_id` nullable — was rejected:
 * it migrates a large, hot table and forces every existing reader to handle
 * NULL, in exchange for merging two logs that are never read together.
 */
export const adminSchema = pgSchema("admin");

export const adminAuditAction = adminSchema.enum("admin_audit_action", [
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

/**
 * Append-only log of everything an instance admin did to somebody else's
 * account. Never updated, never deleted from the app.
 *
 * Actor and target are stored twice: as a foreign key (for joins while the
 * account exists) and as a denormalized name/email snapshot. `user.deleted` is
 * precisely the event whose subject the FK cannot survive, so the record that
 * proves who deleted whom must not depend on either row still being there.
 */
export const adminAudit = adminSchema.table(
  "admin_audit",
  {
    id: id(),
    /** The real human who acted — never the impersonated identity. */
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
    targetEmail: text("target_email"),
    action: adminAuditAction("action").notNull(),
    /** Event-specific detail: ban reason and expiry, old/new role, session count. */
    metadata: jsonb("metadata"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("admin_audit_created_idx").on(t.createdAt),
    index("admin_audit_target_idx").on(t.targetUserId),
    index("admin_audit_actor_idx").on(t.actorId),
  ],
);
