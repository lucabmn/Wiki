import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import SignUpForm from "@/components/auth/sign-up-form";
import { getSignedIn } from "@/functions/get-session";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/auth/register")({
  head: () => pageTitle("Registrieren"),
  // Guest-only: someone already signed in has nothing to do here.
  beforeLoad: async () => {
    const { signedIn } = await getSignedIn();
    if (signedIn) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

// Sign-in and sign-up are separate routes (instead of a local toggle) so the
// URL always reflects the visible form — refresh, back/forward, and shared
// links behave as expected.
function RouteComponent() {
  const navigate = useNavigate();
  return <SignUpForm onSwitchToSignIn={() => navigate({ to: "/auth/login" })} />;
}
