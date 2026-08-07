import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

/** What `instance.registration` reports, plus the shape the forms actually ask for. */
export type RegistrationMode = "open" | "invite" | "closed";

/**
 * The deployment's registration policy, for the two auth screens.
 *
 * Rendered UI is never the enforcement point — `signupPolicyPlugin` on the
 * server is — this only keeps the screens from offering a door that is bolted
 * shut. Which is why the fallback while loading (and on failure) is `open`: a
 * momentarily unreachable API should degrade to "show the form and let the
 * server answer", not to "this instance takes no registrations".
 */
export function useRegistrationPolicy(): {
  mode: RegistrationMode;
  emailVerificationRequired: boolean;
  isPending: boolean;
} {
  const { data, isPending } = useQuery(
    orpc.instance.registration.queryOptions({
      // The policy changes with a redeploy, not within a session.
      staleTime: 5 * 60 * 1000,
    }),
  );

  return {
    mode: data?.mode ?? "open",
    emailVerificationRequired: data?.emailVerificationRequired ?? false,
    isPending,
  };
}
