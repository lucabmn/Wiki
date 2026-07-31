import { createMiddleware } from "@tanstack/react-start";
import { getResponse } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

const guestOnlyRoutePaths = new Set(["/auth/login", "/auth/register"]);
const onboardingPath = "/auth/onboarding";

// better-auth's client actions are typed as `Promise<any>`, so pull the real
// shapes from `$Infer` for full type safety.
type Session = typeof authClient.$Infer.Session | null;
type Organization = typeof authClient.$Infer.ActiveOrganization | null;

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  // Server-side better-auth calls need the incoming cookies forwarded.
  const fetchOptions = { headers: request.headers } as const;

  const session: Session = await authClient.getSession({
    fetchOptions: { ...fetchOptions, throw: true },
  });

  const pathname = new URL(request.url).pathname;

  let organization: Organization = null;

  if (!session) {
    // 1. Not authenticated → login (guest routes still render, no redirect loop).
    if (!guestOnlyRoutePaths.has(pathname)) {
      throw redirect({ to: "/auth/login" });
    }
  } else {
    // Authenticated user should never sit on login/register.
    if (guestOnlyRoutePaths.has(pathname)) {
      throw redirect({ to: "/" });
    }

    let activeOrganizationId = session.session.activeOrganizationId;
    // Distinguishes "activation failed" from "user belongs to no org at all" —
    // only the latter belongs in onboarding.
    let hasMembership = Boolean(activeOrganizationId);

    // 2. No active org → adopt the first org the user belongs to, if any.
    //    Normally handled at session creation (see the `session.create.before`
    //    hook in @nilovon-wiki/auth); this covers memberships gained mid-session.
    if (!activeOrganizationId) {
      const { data: organizations, error: listError } = await authClient.organization.list({
        fetchOptions,
      });

      // A failed lookup means "membership unknown", not "no orgs" — treating it
      // as the latter would send an existing member to onboarding.
      if (listError) {
        hasMembership = true;
      }

      if (organizations && organizations.length > 0) {
        hasMembership = true;
        const { error } = await authClient.organization.setActive({
          organizationId: organizations[0].id,
          fetchOptions: {
            ...fetchOptions,
            // `setActive` re-signs the session cookie (and its 5-minute cache).
            // This call is server-to-server, so without forwarding its cookies
            // the browser keeps a cached session with no active org and every
            // subsequent RPC 400s with "No active organization".
            onSuccess: (ctx) => {
              const cookies = ctx.response.headers.getSetCookie();
              for (const cookie of cookies) {
                getResponse().headers.append("set-cookie", cookie);
              }
            },
          },
        });

        // A failed activation must not be reported as success — the page would
        // render while every org-scoped RPC rejects.
        if (!error) {
          activeOrganizationId = organizations[0].id;
        }
      }
    }

    if (activeOrganizationId) {
      // 3. Active org → load full organization info.
      const { data } = await authClient.organization.getFullOrganization({
        query: { organizationId: activeOrganizationId },
        fetchOptions,
      });

      organization = data;
    } else if (!hasMembership && pathname !== onboardingPath) {
      // 4. No org at all → onboarding. A member whose activation failed renders
      //    without an org instead, rather than being pushed into creating a
      //    duplicate one.
      throw redirect({ to: onboardingPath });
    }
  }

  return next({ context: { session, organization } });
});
