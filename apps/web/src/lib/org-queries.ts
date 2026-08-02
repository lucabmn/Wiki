// Shared TanStack Query wiring for better-auth's organization APIs. Roles and
// members are owned by better-auth (the single source of truth), so these live
// outside the oRPC surface — but we still wrap them in queries/mutations so the
// settings UI caches and invalidates them like any other data.

import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";

import { authClient } from "./auth-client";
import { PERMISSION_QUERY_KEY } from "./permissions";

export const ORG_MEMBERS_KEY = ["organization", "members"] as const;
export const ORG_ROLES_KEY = ["organization", "roles"] as const;
export const ORG_INVITATIONS_KEY = ["organization", "invitations"] as const;
export const ORG_TEAMS_KEY = ["organization", "teams"] as const;
export const ORG_TEAM_MEMBERS_KEY = ["organization", "teamMembers"] as const;

/** A dynamic role ("group") as returned by `listRoles` — permission is parsed. */
export type OrgRole = {
  id: string;
  role: string;
  organizationId: string;
  permission: PermissionRequest;
  createdAt: string | Date;
  updatedAt?: string | Date;
};

function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error) throw new Error(result.error.message ?? "Anfrage fehlgeschlagen");
  return result.data as T;
}

export function membersQueryOptions(organizationId: string | null) {
  return {
    queryKey: [...ORG_MEMBERS_KEY, organizationId] as const,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const result = await authClient.organization.listMembers({
        query: organizationId ? { organizationId } : undefined,
      });
      return unwrap(result);
    },
  };
}

export function rolesQueryOptions(organizationId: string | null) {
  return {
    queryKey: [...ORG_ROLES_KEY, organizationId] as const,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const result = await authClient.organization.listRoles({
        query: organizationId ? { organizationId } : undefined,
      });
      return unwrap(result) as unknown as OrgRole[];
    },
  };
}

export function invitationsQueryOptions(organizationId: string | null) {
  return {
    queryKey: [...ORG_INVITATIONS_KEY, organizationId] as const,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const result = await authClient.organization.listInvitations({
        query: organizationId ? { organizationId } : undefined,
      });
      return unwrap(result);
    },
  };
}

export function teamsQueryOptions(organizationId: string | null) {
  return {
    queryKey: [...ORG_TEAMS_KEY, organizationId] as const,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const result = await authClient.organization.listTeams({
        query: organizationId ? { organizationId } : undefined,
      });
      return unwrap(result);
    },
  };
}

/**
 * The members of one team. Better Auth returns bare `{ userId }` rows — join
 * against `membersQueryOptions` for names, rather than fetching users again.
 */
export function teamMembersQueryOptions(teamId: string | null) {
  return {
    queryKey: [...ORG_TEAM_MEMBERS_KEY, teamId] as const,
    enabled: Boolean(teamId),
    queryFn: async () => {
      const result = await authClient.organization.listTeamMembers({
        query: { teamId: teamId as string },
      });
      return unwrap(result);
    },
  };
}

/**
 * Refresh every surface that a role/member change can affect: the settings
 * queries, the cached permission checks that gate UI affordances, and the SSR
 * route context (`router.invalidate()`) that feeds the sidebar and member lists.
 * Call this in every settings mutation's `onSuccess`.
 */
export function useOrgRefresh() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ORG_MEMBERS_KEY }),
      queryClient.invalidateQueries({ queryKey: ORG_ROLES_KEY }),
      queryClient.invalidateQueries({ queryKey: ORG_INVITATIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: ORG_TEAMS_KEY }),
      queryClient.invalidateQueries({ queryKey: ORG_TEAM_MEMBERS_KEY }),
      queryClient.invalidateQueries({ queryKey: PERMISSION_QUERY_KEY }),
    ]);
    await router.invalidate();
  };
}

/** Static role names that ship in code; a group may not reuse these. */
export const RESERVED_ROLE_NAMES = ["owner", "admin", "member"] as const;
