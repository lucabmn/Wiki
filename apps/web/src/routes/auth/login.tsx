import { createFileRoute, useNavigate } from "@tanstack/react-router";

import SignInForm from "@/components/auth/sign-in-form";

export const Route = createFileRoute("/auth/login")({
  component: RouteComponent,
});

// Sign-in and sign-up are separate routes (instead of a local toggle) so the
// URL always reflects the visible form — refresh, back/forward, and shared
// links behave as expected.
function RouteComponent() {
  const navigate = useNavigate();
  return <SignInForm onSwitchToSignUp={() => navigate({ to: "/auth/register" })} />;
}
