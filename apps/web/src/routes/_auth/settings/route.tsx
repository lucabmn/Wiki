import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { checkStaticRolePermission } from "@/lib/permissions";

export const Route = createFileRoute("/_auth/settings")({
  // Gate the whole settings area on a management right. This is a UX guard using
  // the caller's *static* role from SSR context; the server re-checks every
  // mutation, so dynamic-role holders are still enforced server-side.
  //
  // Known limitation: a user whose management rights come *solely* from a custom
  // group (e.g. a group granted `member`/`ac`) is fail-closed out of this UI,
  // because the check is static-only. The server would admit them; to open the
  // client too, swap this for a server-backed check (`usePermission`) in a
  // loader-friendly form. Acceptable for now — owners/admins are unaffected.
  beforeLoad: ({ context }) => {
    const { organization, session } = context.auth;
    const me = organization.members.find((member) => member.user.id === session.user.id);
    const role = me?.role ?? "";
    const canManage =
      checkStaticRolePermission({ member: ["update"] }, role) ||
      checkStaticRolePermission({ ac: ["create"] }, role);
    if (!canManage) throw redirect({ to: "/" });
  },
  component: SettingsLayout,
});

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
