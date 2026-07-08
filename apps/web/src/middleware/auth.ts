import { createMiddleware } from "@tanstack/react-start";
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

    // 2. No active org → adopt the first org the user belongs to, if any.
    if (!activeOrganizationId) {
      const { data: organizations } = await authClient.organization.list({ fetchOptions });

      if (organizations && organizations.length > 0) {
        await authClient.organization.setActive({
          organizationId: organizations[0].id,
          fetchOptions,
        });
        activeOrganizationId = organizations[0].id;
      }
    }

    if (activeOrganizationId) {
      // 3. Active org → load full organization info.
      const { data } = await authClient.organization.getFullOrganization({
        query: { organizationId: activeOrganizationId },
        fetchOptions,
      });

      organization = data;
    } else if (pathname !== onboardingPath) {
      // 4. No org at all → onboarding.
      throw redirect({ to: onboardingPath });
    }
  }

  return next({ context: { session, organization } });
});
