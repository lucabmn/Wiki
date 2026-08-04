import type { Database } from "@nilovon-wiki/db";
import { activity, adminAudit, adminAuditAction, member } from "@nilovon-wiki/db/schema/index";
import { eq } from "drizzle-orm";

export type AdminAuditAction = (typeof adminAuditAction.enumValues)[number];

/** Actor or target of an admin event, denormalized so the row outlives the account. */
export type AuditIdentity = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type AdminAuditEntry = {
  action: AdminAuditAction;
  /** The real human who acted — never an impersonated identity. */
  actor: AuditIdentity | null;
  target: AuditIdentity | null;
  metadata?: Record<string, unknown>;
};

/**
 * Appends one row to the instance audit log.
 *
 * Never throws into the caller: an audit write failing must not roll back the
 * ban that already happened, and swallowing it here keeps every call site free
 * of defensive plumbing. A failed write is logged so it is not silent.
 */
export async function recordAdminAudit(db: Database, entry: AdminAuditEntry): Promise<void> {
  try {
    await db.insert(adminAudit).values({
      action: entry.action,
      actorId: entry.actor?.id ?? null,
      actorEmail: entry.actor?.email ?? null,
      targetUserId: entry.target?.id ?? null,
      targetEmail: entry.target?.email ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (error) {
    console.error("[admin-audit] failed to record", entry.action, error);
  }
}

/**
 * Mirrors an impersonation event into the *target's* own activity feed.
 *
 * The instance audit log answers to operators; this answers to the person whose
 * account was used. They cannot open the admin console, so without this the
 * only record of someone signing in as them lives somewhere they may not look.
 *
 * `actorId` is the target and `impersonatedBy` the admin — the same attribution
 * every write during the impersonated session carries, which is what makes the
 * event show up in the target's own activity filter rather than the admin's.
 */
export async function mirrorImpersonationActivity(
  db: Database,
  input: {
    action: Extract<AdminAuditAction, "impersonation.started" | "impersonation.ended">;
    target: AuditIdentity;
    admin: AuditIdentity;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // One row per organization the target belongs to: the feed is org-scoped,
    // and they must find the event in whichever org they happen to open.
    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, input.target.id));
    if (memberships.length === 0) return;

    await db.insert(activity).values(
      memberships.map((row) => ({
        organizationId: row.organizationId,
        action: input.action,
        actorId: input.target.id,
        impersonatedBy: input.admin.id,
        metadata: {
          adminName: input.admin.name ?? null,
          adminEmail: input.admin.email ?? null,
          ...input.metadata,
        },
      })),
    );
  } catch (error) {
    console.error("[admin-audit] failed to mirror impersonation activity", error);
  }
}
