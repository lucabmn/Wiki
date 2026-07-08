import DashboardLayout from "@/components/layouts/dashhobard-layout";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <DashboardLayout>
      <div>Hello "/_auth/template"!</div>
    </DashboardLayout>
  );
}
