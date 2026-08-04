import { createServerFn } from "@tanstack/react-start";

import { isInstanceAdminSession } from "@/lib/instance-admin";
import { authMiddleware } from "@/middleware/auth";

/**
 * Resolves instance-admin rights **on the server**, from the session the
 * request's cookies prove — not from anything the browser could set.
 *
 * The `/admin` routes gate on this in `beforeLoad`, so typing the URL is turned
 * away exactly like a hidden nav entry would be. It is a convenience, not the
 * security boundary: every admin procedure re-checks server-side.
 */
export const getInstanceAdmin = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) => {
    return { isInstanceAdmin: isInstanceAdminSession(context.session) };
  });
