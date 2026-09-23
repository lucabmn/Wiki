import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { authClient } from "@/lib/auth-client";

/**
 * Whether the request carries a valid session — without the redirects of
 * `authMiddleware`. For guest-only routes (login, register), which must render
 * for signed-out visitors and only bounce signed-in ones.
 */
export const getSignedIn = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await authClient.getSession({
    fetchOptions: { headers: getRequestHeaders() },
  });
  return { signedIn: Boolean(data?.session) };
});
