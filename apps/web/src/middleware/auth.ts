import { createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

const guestOnlyRoutePaths = new Set(["/auth/login", "/auth/register"]);

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: request.headers,
      throw: true,
    },
  });

  const pathname = new URL(request.url).pathname;

  if (session && guestOnlyRoutePaths.has(pathname)) {
    throw redirect({ to: "/" });
  }

  if (!session) {
    throw redirect({ to: "/auth/login" });
  }

  return next({
    context: { session },
  });
});
