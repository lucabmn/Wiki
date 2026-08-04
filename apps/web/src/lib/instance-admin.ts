import { splitRoles } from "./roles";

/**
 * Client-side mirror of `packages/auth/src/instance-admin.ts`.
 *
 * Deliberately re-stated instead of imported: that module pulls in the server
 * env and the database handle, which would drag both into the browser bundle —
 * the same reason `permissions.ts` is kept server-free. This copy decides what
 * the UI *shows*; the server decides what it *allows* (`instanceAdminProcedure`).
 */
export const INSTANCE_ADMIN_ROLE = "admin";

/**
 * Loosely typed on purpose: this reads a session object the auth client hands
 * over, which is `undefined` before the first fetch resolves and partial in
 * tests. A missing field means "not an instance admin", never a crash.
 */
type SessionLike = {
  session?: { impersonatedBy?: string | null } | null;
  user?: { role?: string | null } | null;
};

/**
 * True when the signed-in account may open the admin console.
 *
 * An impersonated session never qualifies, even if the impersonated account is
 * itself an admin: the console would then act under a borrowed identity, and
 * the audit log would name the wrong person.
 */
export function isInstanceAdminSession(session: SessionLike | null | undefined): boolean {
  if (!session || session.session?.impersonatedBy) return false;
  return splitRoles(session.user?.role).includes(INSTANCE_ADMIN_ROLE);
}
