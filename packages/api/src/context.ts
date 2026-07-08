import { auth } from "@nilovon-wiki/auth";
import { db } from "@nilovon-wiki/db";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const headers = context.req.raw.headers;
  const session = await auth.api.getSession({
    headers,
  });
  return {
    // forwarded so permission checks can re-issue authenticated better-auth
    // calls (e.g. auth.api.hasPermission) with the caller's cookies/session.
    headers,
    session,
    // The database handle lives on the context so handlers stay thin and the
    // dependency is injectable in tests.
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
