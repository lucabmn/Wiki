import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Building2, LayoutDashboard, ScrollText, ShieldAlert, Users } from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { getInstanceAdmin } from "@/functions/get-instance-admin";

export const Route = createFileRoute("/_auth/admin")({
  // Resolved server-side from the session cookie, so a direct URL is refused
  // just like the hidden navigation entry — see get-instance-admin.ts.
  beforeLoad: async () => {
    const { isInstanceAdmin } = await getInstanceAdmin();
    if (!isInstanceAdmin) throw redirect({ to: "/" });
  },
  component: AdminLayout,
});

// `exact` only for the index: every other tab is a prefix of its detail routes,
// so the tab must stay marked active while a user or organization is open.
const TABS = [
  { to: "/admin", label: "Übersicht", icon: LayoutDashboard, exact: true },
  { to: "/admin/users", label: "Benutzer", icon: Users, exact: false },
  { to: "/admin/organizations", label: "Organisationen", icon: Building2, exact: false },
  { to: "/admin/audit", label: "Protokoll", icon: ScrollText, exact: false },
] as const;

/**
 * Shell for the instance-admin console.
 *
 * The banner is not decoration: this area is the one place in the app where a
 * single click affects somebody else's account across every organization, and
 * the boundary to org administration is easy to blur. Naming it once, at the
 * top, is cheaper than explaining it on each page.
 */
function AdminLayout() {
  return (
    <DashboardLayout className="gap-0 p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Instanz-Verwaltung</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Konten, Sitzungen und Zustand dieser Installation. Das ist etwas anderes als die
            Verwaltung einer Organisation — hier zählen keine Org-Rollen, und Seiteninhalte werden
            bewusst nicht angezeigt.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <ShieldAlert className="size-3.5" aria-hidden />
          Instanzweit
        </span>
      </header>

      <nav
        aria-label="Instanz-Verwaltung"
        className="mt-6 flex gap-1 overflow-x-auto border-b border-border pb-px"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.exact }}
            className="-mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:border-foreground data-[status=active]:text-foreground"
          >
            <tab.icon className="size-4 shrink-0" aria-hidden />
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="min-w-0 pt-6">
        <Outlet />
      </div>
    </DashboardLayout>
  );
}
