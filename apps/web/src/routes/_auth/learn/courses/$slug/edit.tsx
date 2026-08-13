import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/learn/courses/$slug/edit")({
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
