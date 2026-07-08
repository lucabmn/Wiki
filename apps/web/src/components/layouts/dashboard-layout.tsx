import { ReactNode } from "react";
import { cn } from "@nilovon-wiki/ui/lib/utils";

// The sidebar chrome (SidebarProvider + MainSidebar + SidebarInset) lives in the
// _auth layout route, so it mounts once and keeps its state across navigation.
// This wrapper only provides the page content column.
export default function DashboardLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <main className={cn("flex flex-1 flex-col gap-4", className)}>{children}</main>;
}
