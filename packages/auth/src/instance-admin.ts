import type { Database } from "@nilovon-wiki/db";
import { user } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";
import { eq, isNull, or, sql } from "drizzle-orm";

/**
 * Instance roles, stored in `auth.user.role` as a comma-separated list.
 *
 * This is a different axis from the organization roles in `permissions.ts`: an
 * instance admin operates the deployment (accounts, sessions, instance health),
 * an org owner/admin operates one tenant's content. Neither implies the other —
 * being an instance admin grants no organization membership and no read access
 * to wiki content. See `docs/permissions.md`.
 */
export const INSTANCE_ROLE_ADMIN = "admin";
export const INSTANCE_ROLE_USER = "user";

/** Roles the Better Auth `admin()` plugin treats as instance admins. */
export const INSTANCE_ADMIN_ROLES = [INSTANCE_ROLE_ADMIN];

/** Splits `user.role` the same way Better Auth's admin plugin does. */
export function splitInstanceRoles(role: string | null | undefined): string[] {
  return (role ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * True when `role` carries an instance-admin role.
 *
 * Callers must additionally reject impersonated sessions: while impersonating,
 * `session.user.role` is the *target's* role, so an admin who impersonates
 * another admin would otherwise keep the console — under the wrong identity.
 */
export function hasInstanceAdminRole(role: string | null | undefined): boolean {
  return splitInstanceRoles(role).some((r) => INSTANCE_ADMIN_ROLES.includes(r));
}

/** Adds the admin role to an existing comma-separated role list, idempotently. */
export function withInstanceAdminRole(role: string | null | undefined): string {
  const roles = splitInstanceRoles(role);
  if (roles.includes(INSTANCE_ROLE_ADMIN)) return roles.join(",");
  return [...roles, INSTANCE_ROLE_ADMIN].join(",");
}

/**
 * Promotes `INITIAL_ADMIN_EMAIL` to instance admin.
 *
 * Two call sites cover the two orders operators actually hit: this one runs at
 * server startup (address configured for an account that already exists), and a
 * `user.create.before` hook stamps the role at registration (address configured
 * before anyone signed up). Both are idempotent.
 *
 * Only accounts that are not already admins are touched, so an operator who
 * later points the variable at somebody else promotes them without demoting
 * anyone — revoking admin stays a deliberate act in the console.
 */
export async function ensureInitialAdmin(db: Database): Promise<boolean> {
  const email = env.INITIAL_ADMIN_EMAIL;
  if (!email) return false;

  const updated = await db
    .update(user)
    .set({ role: INSTANCE_ROLE_ADMIN })
    .where(
      sql`lower(${user.email}) = ${email.toLowerCase()} and (${or(
        isNull(user.role),
        eq(user.role, INSTANCE_ROLE_USER),
        eq(user.role, ""),
      )})`,
    )
    .returning({ id: user.id });

  return updated.length > 0;
}

/** True when the address matches `INITIAL_ADMIN_EMAIL` (case-insensitively). */
export function isInitialAdminEmail(email: string): boolean {
  const configured = env.INITIAL_ADMIN_EMAIL;
  return !!configured && configured.toLowerCase() === email.toLowerCase();
}
