import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import SignInForm from "@/components/auth/sign-in-form";

/**
 * A failed SSO sign-in comes *back* here as a redirect, not as a rejected
 * promise: the identity provider hands the browser to `/sso/callback/…`, and
 * anything that goes wrong there lands on `errorCallbackURL` with the reason in
 * the query string. Without reading it, the person is dropped on a blank login
 * form with no idea why — the same dead end the button's own error messages
 * exist to prevent, one redirect later.
 */
type SSOCallbackSearch = { error?: string; error_description?: string };

export const Route = createFileRoute("/auth/login")({
  // Both keys stay *optional properties* rather than `string | undefined`: every
  // other route links here with a bare `to: "/auth/login"`, and a union type
  // would make `search` a required argument at all ten of those call sites.
  validateSearch: (search: Record<string, unknown>): SSOCallbackSearch => ({
    ...(typeof search.error === "string" ? { error: search.error } : {}),
    ...(typeof search.error_description === "string"
      ? { error_description: search.error_description }
      : {}),
  }),
  component: RouteComponent,
});

/** The failures Better Auth can hand back from the SSO callback. */
function ssoCallbackMessage(code: string, description: string | undefined): string {
  switch (code) {
    case "account not linked":
      return "Zu dieser E-Mail-Adresse gibt es bereits ein Konto, das nicht mit dem Anbieter verknüpft ist. Melde dich mit deinem Passwort an oder wende dich an eure IT.";
    case "signup disabled":
      return "Für diese Adresse gibt es hier noch kein Konto, und neue Konten werden über diesen Anbieter nicht automatisch angelegt.";
    case "unable to link account":
    case "unable to create user":
    case "unable to create session":
      return "Das Konto konnte nicht angelegt oder verknüpft werden. Bitte versuche es erneut oder wende dich an eure IT.";
    default:
      return description
        ? `Anmeldung über Single Sign-On fehlgeschlagen: ${description}`
        : "Anmeldung über Single Sign-On fehlgeschlagen.";
  }
}

// Sign-in and sign-up are separate routes (instead of a local toggle) so the
// URL always reflects the visible form — refresh, back/forward, and shared
// links behave as expected.
function RouteComponent() {
  const navigate = useNavigate();
  const { error, error_description: description } = Route.useSearch();

  useEffect(() => {
    if (!error) return;
    toast.error(ssoCallbackMessage(error, description));
    // Drop the params so a refresh — or switching to sign-up and back — does not
    // re-announce a failure the person has already seen.
    navigate({ to: "/auth/login", search: {}, replace: true });
  }, [error, description, navigate]);

  return <SignInForm onSwitchToSignUp={() => navigate({ to: "/auth/register" })} />;
}
