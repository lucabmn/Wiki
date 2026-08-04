import { ORPCError, os } from "@orpc/server";
import { auth } from "@nilovon-wiki/auth";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";

import type { AuthedContext, Context } from "./context";
import { assertTwoFactorCompliance } from "./lib/two-factor-policy";

export { TWO_FACTOR_REQUIRED } from "./lib/two-factor-policy";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  const { session } = context;
  if (!session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  // Forward headers so downstream permission checks can re-issue authenticated
  // better-auth calls with the caller's session. Returning the narrowed
  // `session` types it non-null for every downstream handler.
  return next({
    context: {
      headers: context.headers,
      session,
    },
  });
});

/**
 * Refuses callers who owe their organization a second factor.
 *
 * The three exemptions the policy needs are structural rather than listed here:
 * enrolling a second factor, signing out and the rest of `/api/auth/*` are
 * served by Better Auth and never reach oRPC, and `/health` is a
 * `publicProcedure`. What still has to be reachable *inside* oRPC — the status
 * the blocking screen renders — is built on `sessionProcedure` below.
 */
const requireTwoFactorCompliance = o.middleware(async ({ context, next }) => {
  await assertTwoFactorCompliance(context.db, context.session);
  return next();
});

/**
 * Signed in, but *not* subject to the two-factor policy. Reserved for the
 * handful of procedures a blocked user must still reach; everything else wants
 * `protectedProcedure`.
 */
export const sessionProcedure = publicProcedure.use(requireAuth);

export const protectedProcedure = sessionProcedure.use(requireTwoFactorCompliance);

// Resolves the caller's active organization, throwing when none is set. Most
// create/list flows are scoped to it. Cross-org mutations should instead gate
// on the *resource's* org id (see `assertOrgPermission`).
export function requireActiveOrg(context: AuthedContext): string {
  const organizationId = context.session.session.activeOrganizationId;
  if (!organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "No active organization. Select one before continuing.",
    });
  }
  return organizationId;
}

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

// True when the caller is an org owner/admin (holds member-management). Used as
// the global override for per-space write authorization — computed once per
// request and threaded into the space-role resolver. Owner/admin hold
// `member:["update"]`; a custom group granted member-management counts too.
export async function isOrgManager(headers: Headers, organizationId?: string): Promise<boolean> {
  return hasOrgPermission(headers, { member: ["update"] }, organizationId);
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

// Owner-aware guard for mutations on user-authored resources: the resource
// owner may act when they hold any of `ownerPermissions`; anyone else needs
// `otherPermissions` (typically a moderate/delete-others grant).
export async function assertOwnerOrPermission(opts: {
  headers: Headers;
  organizationId: string;
  isOwner: boolean;
  /** Checked in order for the owner; the first grant that succeeds wins. */
  ownerPermissions: PermissionRequest[];
  /** Required when the caller does not own the resource. */
  otherPermissions: PermissionRequest;
}): Promise<void> {
  const { headers, organizationId } = opts;
  if (!opts.isOwner) {
    return assertOrgPermission(headers, opts.otherPermissions, organizationId);
  }
  for (const permissions of opts.ownerPermissions) {
    if (await hasOrgPermission(headers, permissions, organizationId)) {
      return;
    }
  }
  throw new ORPCError("FORBIDDEN");
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
