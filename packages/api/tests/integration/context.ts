import type { Context } from "../../src/context";
import type { TestDb } from "./db";

/**
 * Builds a handler `Context` for tests: the injected pglite db plus a synthetic
 * session. Authorization (`auth.api.hasPermission`) is mocked separately per
 * test file, so only `db` and the session identity matter here.
 */
export function testContext(
  db: TestDb,
  opts: { userId: string; activeOrganizationId: string | null },
): Context {
  return {
    db,
    headers: new Headers(),
    session: {
      session: { activeOrganizationId: opts.activeOrganizationId },
      user: { id: opts.userId },
    },
  } as unknown as Context;
}
