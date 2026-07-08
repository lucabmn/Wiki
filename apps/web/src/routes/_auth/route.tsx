import { Outlet, createFileRoute } from "@tanstack/react-router";

import { getUser } from "@/functions/get-user";
import { SidebarInset, SidebarProvider } from "@nilovon-wiki/ui/components/sidebar";

export const Route = createFileRoute("/_auth")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async () => {
    const auth = await getUser();
    return { auth };
  },
});

function AuthLayout() {
  return (
    <SidebarProvider>
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
