import { ORPCError, os } from "@orpc/server";
import { auth } from "@nilovon-wiki/auth";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  // Forward headers so downstream permission checks can re-issue authenticated
  // better-auth calls with the caller's session.
  return next({
    context: {
      headers: context.headers,
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

// Resolves the caller's role from their member row in `organizationId` (or the
// active org when omitted) and evaluates it — covering static and dynamic roles.
// Pass the resource's org id explicitly; the active org can differ from the
// resource's, which would otherwise leak cross-org access.
export async function hasOrgPermission(
  headers: Headers,
  permissions: PermissionRequest,
  organizationId?: string,
): Promise<boolean> {
  const { success } = await auth.api.hasPermission({
    headers,
    body: organizationId ? { permissions, organizationId } : { permissions },
  });
  return success;
}

// Throwing variant for use inside handlers once the resource's org is known.
export async function assertOrgPermission(
  headers: Headers,
  permissions: PermissionRequest,
  organizationId?: string,
): Promise<void> {
  if (!(await hasOrgPermission(headers, permissions, organizationId))) {
    throw new ORPCError("FORBIDDEN");
  }
}

// Gates a route behind an org permission, checked against the active org. For
// routes targeting an arbitrary org, use `protectedProcedure` and call
// `assertOrgPermission` inside the handler with the resource's org id.
//
//   requireOrgPermission({ page: ["delete"] })
//     .input(z.object({ pageId: z.string() }))
//     .handler(async ({ input, context }) => { ... })
export function requireOrgPermission(permissions: PermissionRequest) {
  return protectedProcedure.use(async ({ context, next }) => {
    await assertOrgPermission(context.headers, permissions);
    return next();
  });
}
