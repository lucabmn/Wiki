import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { useQuery } from "@tanstack/react-query";

import { authClient } from "./auth-client";

type BuiltInRole = "owner" | "admin" | "member";

/**
 * Root query key for every server-backed permission check. Invalidate it after
 * any role/group/member mutation so gated UI re-resolves against the new grants:
 *
 *   queryClient.invalidateQueries({ queryKey: PERMISSION_QUERY_KEY });
 */
export const PERMISSION_QUERY_KEY = ["organization", "hasPermission"] as const;

/**
 * Server-backed permission check — the default for UI gating. Round-trips to
 * better-auth's `organization.hasPermission`, which resolves **both** static and
 * dynamic roles (groups) for the caller's active organization, then caches the
 * answer in TanStack Query so many elements gated off one permission share a
 * single request.
 *
 * This is why it must be async: the browser can only evaluate *static* roles
 * synchronously (see `checkStaticRolePermission`); dynamic roles live in the DB
 * and only the server can resolve them.
 *
 * Fail-closed: `allowed` is `false` while the check is pending and on any error.
 */
export function usePermission(permissions: PermissionRequest): {
  allowed: boolean;
  isPending: boolean;
} {
  const { data: session } = authClient.useSession();
  const activeOrgId = session?.session.activeOrganizationId ?? null;

  const query = useQuery({
    queryKey: [...PERMISSION_QUERY_KEY, activeOrgId, permissions],
    enabled: Boolean(activeOrgId),
    // Effective permissions change only when roles/members are edited; those
    // flows invalidate PERMISSION_QUERY_KEY explicitly, so a long stale time
    // avoids redundant round-trips without going stale in practice.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await authClient.organization.hasPermission({ permissions });
      if (error) return false;
      return data?.success ?? false;
    },
  });

  return {
    allowed: query.data ?? false,
    // With no active org the query never runs; report "settled" so callers don't
    // spin forever on a check that can't resolve.
    isPending: Boolean(activeOrgId) && query.isPending,
  };
}

/**
 * Server-backed "any of these" check — the OR of several permission requests,
 * resolved in one query so a gate that admits several distinct rights (e.g. the
 * settings area: manage members *or* manage groups *or* manage the org) settles
 * as a single unit instead of flickering between per-check pending states.
 *
 * Same fail-closed contract as `usePermission`, and it hangs off the same
 * `PERMISSION_QUERY_KEY` prefix so role changes invalidate it too.
 */
export function useAnyPermission(requests: PermissionRequest[]): {
  allowed: boolean;
  isPending: boolean;
} {
  const { data: session } = authClient.useSession();
  const activeOrgId = session?.session.activeOrganizationId ?? null;

  const query = useQuery({
    queryKey: [...PERMISSION_QUERY_KEY, activeOrgId, "any", requests],
    enabled: Boolean(activeOrgId),
    staleTime: 60_000,
    queryFn: async () => {
      const results = await Promise.all(
        requests.map(async (permissions) => {
          const { data, error } = await authClient.organization.hasPermission({ permissions });
          if (error) return false;
          return data?.success ?? false;
        }),
      );
      return results.some(Boolean);
    },
  });

  return {
    allowed: query.data ?? false,
    isPending: Boolean(activeOrgId) && query.isPending,
  };
}

/**
 * Synchronous, static-only permission check. No network call, so it **cannot**
 * see dynamic roles (groups) — a member whose access comes solely from a group
 * evaluates to `false` here. Use only when you already hold the caller's static
 * role (e.g. a route `beforeLoad` guard reading the member role off SSR context)
 * and need an instant answer; otherwise prefer `usePermission`.
 *
 * A member may hold several comma-separated roles; the permission is granted if
 * any of them satisfies it.
 */
export function checkStaticRolePermission(permissions: PermissionRequest, role: string): boolean {
  return role
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((candidate) => {
      try {
        return authClient.organization.checkRolePermission({
          permissions,
          role: candidate as BuiltInRole,
        });
      } catch {
        return false;
      }
    });
}
