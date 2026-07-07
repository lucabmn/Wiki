import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { useQuery } from "@tanstack/react-query";

import { authClient } from "./auth-client";

// Order-independent cache key for a permission request.
function permissionKey(permissions: PermissionRequest): string {
  return Object.entries(permissions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([res, actions]) => `${res}:${[...(actions ?? [])].sort().join(",")}`)
    .join("|");
}

// Invalidate this prefix after mutating roles/members to re-run gated UI:
//   queryClient.invalidateQueries({ queryKey: PERMISSION_QUERY_KEY })
export const PERMISSION_QUERY_KEY = ["org-permission"] as const;

// Does the current user hold `permissions` in the active organization?
//
// Runs server-side (accounts for static AND dynamic "group" roles) and caches
// in TanStack Query, so gating many elements off one permission is one request.
// The client always checks the session's active org; switch orgs via `setActive`.
export function usePermission(permissions: PermissionRequest) {
  const { data: session } = authClient.useSession();
  const activeOrgId = session?.session.activeOrganizationId ?? null;

  const query = useQuery({
    queryKey: [...PERMISSION_QUERY_KEY, activeOrgId, permissionKey(permissions)],
    enabled: Boolean(activeOrgId),
    queryFn: async () => {
      const res = await authClient.organization.hasPermission({ permissions });
      if (res.error) {
        throw new Error(res.error.message ?? "Permission check failed");
      }
      return res.data?.success ?? false;
    },
  });

  return {
    allowed: query.data === true,
    isPending: query.isPending,
    error: query.error,
    query,
  };
}

// Synchronous check against a static role's permissions. No network, so it
// ignores dynamic roles — use `usePermission` when those matter.
export function checkStaticRolePermission(
  permissions: PermissionRequest,
  role: "owner" | "admin" | "member",
): boolean {
  return authClient.organization.checkRolePermission({ permissions, role });
}
