import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";

import { authClient } from "./auth-client";

type BuiltInRole = "owner" | "admin" | "member";

/**
 * Client-side mirror of the server's `assertOrgPermission`. Resolves the active
 * member's role and evaluates `permissions` against the shared access-control
 * definitions (`ac`/`roles`) — the *same* statements the server enforces, so the
 * UI hides affordances a mutation would reject rather than letting the user hit
 * a 403. This is a UX guard only; the server remains the source of truth.
 *
 * A member may hold several comma-separated roles; the permission is granted if
 * any of them satisfies it. Dynamic roles the browser can't resolve fall through
 * to "not allowed" (fail-closed).
 */
export function usePermission(permissions: PermissionRequest): boolean {
  const { data: member } = authClient.useActiveMember();
  const role = member?.role;
  if (!role) return false;
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
