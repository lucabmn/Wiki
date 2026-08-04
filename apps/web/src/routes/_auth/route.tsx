import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";
import { NotificationBell } from "@/components/inbox/notification-bell";
import MainSidebar from "@/components/main-sidebar";
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
  return (
    // Pin the shell to its grid row (see __root.tsx) so the sidebar stays fixed
    // and only the content column scrolls — on every _auth page. `h-full`
    // rather than `h-svh`: the impersonation banner sits in the row above and
    // would otherwise push the whole shell a banner-height off-screen.
    <SidebarProvider className="h-full overflow-hidden">
      <MainSidebar />
      <SidebarInset className="h-full overflow-hidden">
        {/* On narrow viewports the sidebar is an off-canvas sheet; this slim
            bar is its only opener, so it must exist on every page. */}
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
          <SidebarTrigger />
          <span className="flex-1 text-sm font-semibold">Wiki</span>
          {/* The sidebar's bell is off-canvas here, and an unread badge nobody
              can see is not a notification. */}
          <NotificationBell />
        </div>
        <div data-page-scroll className="flex flex-1 flex-col overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
