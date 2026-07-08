import { SidebarInset, SidebarProvider } from "@nilovon-wiki/ui/components/sidebar";
import { ReactNode } from "react";
import MainSidebar from "../main-sidebar";
import { cn } from "@nilovon-wiki/ui/lib/utils";

export default function DashboardLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <SidebarProvider>
      <MainSidebar />
      <SidebarInset>
        <main className={cn("flex flex-1 flex-col gap-4", className)}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
