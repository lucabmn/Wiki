import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  BellRing,
  Building2,
  Fingerprint,
  KeyRound,
  Palette,
  ShieldCheck,
  Timer,
  User,
  Users,
  UsersRound,
  Webhook,
} from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { useIsOrgAdmin } from "@/components/settings/org-admin-gate";
import { ORG_MANAGE_PERMISSIONS } from "@/components/settings/permission-gate";
import { useAnyPermission } from "@/lib/permissions";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsLayout,
});

const PERSONAL_TABS = [
  { to: "/settings/profile", label: "Profil", icon: User },
  { to: "/settings/notifications", label: "Benachrichtigungen", icon: Bell },
  { to: "/settings/security", label: "Sicherheit", icon: ShieldCheck },
  { to: "/settings/appearance", label: "Darstellung", icon: Palette },
] as const;

const ORGANIZATION_TABS = [
  { to: "/settings/organization", label: "Allgemein", icon: Building2 },
  { to: "/settings/members", label: "Mitglieder", icon: Users },
  { to: "/settings/groups", label: "Gruppen", icon: KeyRound },
  { to: "/settings/teams", label: "Teams", icon: UsersRound },
  { to: "/settings/notification-defaults", label: "Benachrichtigungen", icon: BellRing },
  { to: "/settings/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/settings/data-lifecycle", label: "Daten & Fristen", icon: Timer },
] as const;

/**
 * Listed apart because it is the one tab a dynamic group cannot unlock: Better
 * Auth's SSO and SCIM plugins only honour the static `owner`/`admin` roles. It is
 * therefore hidden — rather than shown and then refused — for everyone else.
 */
const ORG_ADMIN_TABS = [
  { to: "/settings/sso", label: "Single Sign-On", icon: Fingerprint },
] as const;

/**
 * Two-section settings shell: personal settings every signed-in user may open,
 * and organization settings only managers see.
 *
 * The area itself is **not** gated anymore — the gate moved onto the individual
 * organization routes (`<PermissionGate>`), because a plain member must still be
 * able to reach their own profile and security settings. The nav merely hides
 * what the caller cannot open; the routes re-check, and the server enforces.
 */
function SettingsLayout() {
  const { allowed: canManageOrg, isPending } = useAnyPermission(ORG_MANAGE_PERMISSIONS);
  const isOrgAdmin = useIsOrgAdmin();

  return (
    <DashboardLayout className="gap-0 p-7">
      <header>
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">
          Verwalte dein Konto und — sofern du dazu berechtigt bist — deine Organisation.
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <nav className="lg:w-52 lg:shrink-0" aria-label="Einstellungen">
          <NavSection title="Konto" tabs={PERSONAL_TABS} />
          {isPending ? (
            <div className="mt-6 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : canManageOrg ? (
            <div className="mt-6">
              <NavSection
                title="Organisation"
                tabs={isOrgAdmin ? [...ORGANIZATION_TABS, ...ORG_ADMIN_TABS] : ORGANIZATION_TABS}
              />
            </div>
          ) : null}
        </nav>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </DashboardLayout>
  );
}

function NavSection({
  title,
  tabs,
}: {
  title: string;
  tabs: readonly { to: string; label: string; icon: typeof User }[];
}) {
  return (
    <div className="space-y-1">
      <div className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </div>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
        >
          <tab.icon className="size-4 shrink-0" />
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
