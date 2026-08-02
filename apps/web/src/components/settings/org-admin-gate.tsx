import type { ReactNode } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { splitRoles } from "@/lib/roles";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";

/** The static roles Better Auth's SSO and SCIM plugins accept. */
const ADMIN_ROLES = ["owner", "admin"];

/**
 * True when the signed-in member holds `owner` or `admin` in the active
 * organization — the exact test the SSO and SCIM plugins apply server-side
 * (`hasOrgAdminRole` / `hasRequiredRole`), including the comma-separated
 * multi-role string this app stores.
 */
export function useIsOrgAdmin(): boolean {
  const { auth } = useRouteContext({ from: "/_auth" });
  const membership = auth.organization.members.find(
    (member) => member.userId === auth.session.user.id,
  );
  return splitRoles(membership?.role).some((role) => ADMIN_ROLES.includes(role));
}

/**
 * Renders `children` only for owners and admins of the active organization.
 *
 * Deliberately *not* [`<PermissionGate>`](./permission-gate.tsx): that resolves
 * dynamic roles ("groups") through `hasPermission`, but the SSO and SCIM plugins
 * ship their own authorization that only understands the static `owner`/`admin`
 * roles. Gating on the wider check would hand a group member a form that the
 * server rejects on submit — so this gate mirrors what actually gets enforced.
 *
 * Resolves synchronously off the SSR route context, so there is no pending state
 * to skeleton over.
 */
export function OrgAdminGate({ children }: { children: ReactNode }) {
  const isOrgAdmin = useIsOrgAdmin();

  if (!isOrgAdmin) {
    return (
      <Empty className="rounded-xl border border-dashed border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Lock />
          </EmptyMedia>
          <EmptyTitle>Kein Zugriff</EmptyTitle>
          <EmptyDescription>
            Anmeldung und Verzeichnis-Synchronisierung darf nur verwalten, wer Inhaber oder
            Administrator dieser Organisation ist — eine Gruppe reicht dafür nicht aus.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <>{children}</>;
}
