import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/certificates/$serial")({
  component: RouteComponent,
});

function RouteComponent() {
  return null;
}
