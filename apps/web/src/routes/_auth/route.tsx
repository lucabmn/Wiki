import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";
import MainSidebar from "@/components/main-sidebar";
import { SidebarInset, SidebarProvider } from "@nilovon-wiki/ui/components/sidebar";

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
    <SidebarProvider>
      <MainSidebar />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
