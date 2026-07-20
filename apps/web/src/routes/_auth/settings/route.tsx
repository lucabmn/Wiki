import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { usePermission } from "@/lib/permissions";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsGuard,
});

/**
 * Gates the whole settings area on a management right. The check is
 * server-backed (`usePermission` → `organization.hasPermission`) so it resolves
 * **dynamic** roles too: a member whose management rights come solely from a
 * custom group reaches this UI, matching what the server already allows on
 * every mutation. A static, role-only check would fail those users closed.
 *
 * `usePermission` is fail-closed while pending, so we must wait for both checks
 * to settle before redirecting — otherwise every visit would bounce to "/".
 */
function SettingsGuard() {
  const navigate = useNavigate();
  const members = usePermission({ member: ["update"] });
  const roles = usePermission({ ac: ["create"] });

  const pending = members.isPending || roles.isPending;
  const canManage = members.allowed || roles.allowed;

  useEffect(() => {
    if (!pending && !canManage) navigate({ to: "/", replace: true });
  }, [pending, canManage, navigate]);

  if (pending) {
    return (
      <DashboardLayout className="gap-0 p-7">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-4 h-64 w-full" />
      </DashboardLayout>
    );
  }
  if (!canManage) return null;

  return <SettingsLayout />;
}

const TABS = [
  { to: "/settings/members", label: "Mitglieder" },
  { to: "/settings/groups", label: "Gruppen" },
] as const;

function SettingsLayout() {
  return (
    <DashboardLayout className="gap-0 p-7">
      <header>
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">
          Verwalte Mitglieder, Rollen und Gruppen deiner Organisation.
        </p>
      </header>

      <nav className="mt-5 flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        <Outlet />
      </div>
    </DashboardLayout>
  );
}
