import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";
import MainSidebar from "@/components/main-sidebar";
import { TwoFactorGate, TwoFactorGraceBanner } from "@/components/security/two-factor-gate";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@nilovon-wiki/ui/components/sidebar";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async () => {
    const auth = await getUser();

    // The auth middleware already redirects unauthenticated/org-less requests,
    // but guard here too so the context below is genuinely non-null.
    if (!auth.session) throw redirect({ to: "/auth/login" });
    if (!auth.organization) throw redirect({ to: "/auth/onboarding" });

    return {
      auth: {
        session: auth.session,
        organization: auth.organization,
      },
    };
  },
});

function AuthLayout() {
  const { auth } = Route.useRouteContext();

  return (
    // The gate wraps the whole shell, not just the content column: a member the
    // server refuses everything would otherwise get a sidebar whose every query
    // fails, on top of the explanation.
    <TwoFactorGate organizationName={auth.organization.name}>
      {/* Pin the shell to the viewport so the sidebar stays fixed and only the
          content column scrolls — on every _auth page. */}
      <SidebarProvider className="h-svh overflow-hidden">
        <MainSidebar />
        <SidebarInset className="h-svh overflow-hidden">
          {/* On narrow viewports the sidebar is an off-canvas sheet; this slim
              bar is its only opener, so it must exist on every page. */}
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
            <SidebarTrigger />
            <span className="text-sm font-semibold">Wiki</span>
          </div>
          <TwoFactorGraceBanner />
          <div data-page-scroll className="flex flex-1 flex-col overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TwoFactorGate>
  );
}
