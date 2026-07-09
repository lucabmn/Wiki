import { createFileRoute, useNavigate } from "@tanstack/react-router";

import SignUpForm from "@/components/auth/sign-up-form";

export const Route = createFileRoute("/auth/register")({
  component: RouteComponent,
});

// Sign-in and sign-up are separate routes (instead of a local toggle) so the
// URL always reflects the visible form — refresh, back/forward, and shared
// links behave as expected.
function RouteComponent() {
  const navigate = useNavigate();
  return <SignUpForm onSwitchToSignIn={() => navigate({ to: "/auth/login" })} />;
}
