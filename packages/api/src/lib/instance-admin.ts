import { ORPCError } from "@orpc/server";

import { hasInstanceAdminRole } from "@nilovon-wiki/auth/instance-admin";

import type { AuthedContext } from "../context";
import { protectedProcedure } from "../index";

/**
 * True when the caller may operate the instance.
 *
 * Two conditions, both necessary:
 *
 * - the account carries an instance-admin role (`auth.user.role`) — deliberately
 *   unrelated to the organization roles in `assertOrgPermission`, so an org
 *   owner gets nothing here, and
 * - the session is not impersonated. While impersonating, `session.user.role`
 *   is the *target's* role; without this check an admin who impersonated
 *   another admin would keep the console under a borrowed identity, and every
 *   action would be audited against the wrong person.
 */
export function isInstanceAdmin(context: AuthedContext): boolean {
  if (context.session.session.impersonatedBy) return false;
  return hasInstanceAdminRole(context.session.user.role);
}

/**
 * Gates a procedure behind instance-admin rights.
 *
 * This is the server-side gate the admin console relies on — hiding the
 * navigation is cosmetic, and every route calls procedures built from here.
 */
export const instanceAdminProcedure = protectedProcedure.use(async ({ context, next }) => {
  if (!isInstanceAdmin(context)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Diese Aktion ist Instanz-Administratoren vorbehalten",
    });
  }
  return next();
});
