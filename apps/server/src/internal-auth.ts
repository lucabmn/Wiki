import { env } from "@nilovon-wiki/env/server";
import type { Context } from "hono";

/**
 * The shared guard for `/internal/**` — the routes a scheduler calls, not a
 * person.
 *
 * One token for every runner, because they are one trust boundary: whoever may
 * trigger the digest run may trigger the retention run, and a second secret
 * would only mean a second thing to rotate and forget. `INTERNAL_RUN_TOKEN` is
 * the name; `DIGEST_RUN_TOKEN` is still accepted so deployments that predate the
 * rename keep working without an edit to their environment.
 */

export function internalRunToken(): string | undefined {
  return env.INTERNAL_RUN_TOKEN ?? env.DIGEST_RUN_TOKEN;
}

export type InternalAuthFailure = { status: 401 | 501; body: { error: string } };

/**
 * Returns null when the caller is authorized, or the response to send back.
 * Shaped as a value rather than middleware so each route keeps its own success
 * payload — the runners return their run summary, which a generic guard would
 * have to swallow.
 */
export function checkInternalAuth(c: Context): InternalAuthFailure | null {
  const expected = internalRunToken();
  if (!expected) {
    return {
      status: 501,
      body: { error: "INTERNAL_RUN_TOKEN is not configured" },
    };
  }
  const header = c.req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(presented, expected)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  return null;
}

/**
 * Constant-time comparison for equal-length strings, so a wrong token cannot be
 * probed byte by byte. The length check short-circuits and therefore leaks the
 * token's length — which is not secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
