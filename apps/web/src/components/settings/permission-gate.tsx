import type { ReactNode } from "react";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { Lock } from "lucide-react";

import { useAnyPermission } from "@/lib/permissions";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * The rights that unlock the organization section of the settings area. Any one
 * of them suffices: they are the three distinct management surfaces (people,
 * groups, the org itself), and a dynamic group may grant them independently.
 */
export const ORG_MANAGE_PERMISSIONS: PermissionRequest[] = [
  { member: ["update"] },
  { ac: ["create"] },
  { organization: ["update"] },
];

/**
 * Renders `children` only for callers who hold at least one of `permissions`.
 *
 * The check is server-backed (`useAnyPermission`) so it resolves **dynamic**
 * roles too — a member whose rights come solely from a custom group reaches the
 * UI, matching what the server already allows on every mutation. A static,
 * role-only check would fail those users closed.
 *
 * Deliberately renders a "no access" panel instead of redirecting: settings tabs
 * now sit next to personal ones that everyone may open, so a denied tab must not
 * throw the whole area away.
 */
export function PermissionGate({
  permissions,
  children,
}: {
  permissions: PermissionRequest[];
  children: ReactNode;
}) {
  const { allowed, isPending } = useAnyPermission(permissions);

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <Empty className="rounded-xl border border-dashed border-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Lock />
          </EmptyMedia>
          <EmptyTitle>Kein Zugriff</EmptyTitle>
          <EmptyDescription>
            Für diesen Bereich fehlen dir die Rechte. Wende dich an eine Person mit
            Administrator-Rechten in dieser Organisation.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <>{children}</>;
}
