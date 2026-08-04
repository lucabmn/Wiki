import { internalRunToken } from "@nilovon-wiki/env/server";

/**
 * Shared-secret guard for the `/internal` runner endpoints.
 *
 * These callers are schedulers, not people: there is no session to check, and
 * the work they start is expensive enough that an unauthenticated trigger would
 * be a denial-of-service lever. One token covers every runner — the digest one
 * came first and its `DIGEST_RUN_TOKEN` still works, but a second runner needing
 * a second secret would just mean two ways to get the same door wrong.
 */
export type InternalAuth = { ok: true } | { ok: false; status: 401 | 501; error: string };

export function checkInternalToken(authorization: string | undefined): InternalAuth {
  if (!internalRunToken) {
    return {
      ok: false,
      status: 501,
      error: "INTERNAL_RUN_TOKEN is not configured",
    };
  }
  const header = authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!timingSafeEqual(presented, internalRunToken)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
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
