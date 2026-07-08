import { SidebarInset, SidebarProvider } from "@nilovon-wiki/ui/components/sidebar";
import { ReactNode } from "react";
import MainSidebar from "../main-sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <MainSidebar />
      <SidebarInset>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
