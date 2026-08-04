/**
 * Makes a ban or an admin session revocation take effect *now* instead of in up
 * to five minutes.
 *
 * Better Auth answers `getSession` straight from a signed cookie for
 * `session.cookieCache.maxAge` seconds, without touching the database. Deleting
 * a user's session rows therefore does not sign them out: their browser keeps
 * presenting a cached copy that still validates. For a ban that is the
 * difference between "locked out" and "locked out in five minutes" — which is
 * the entire point of banning someone.
 *
 * `session.cookieCache.version` is the escape hatch. Better Auth stamps the
 * version into the cached cookie when it writes it, and on every read compares
 * it against the value this module computes; any mismatch discards the cache
 * and falls through to the database, where the session no longer exists.
 * Bumping a per-user counter therefore invalidates exactly that user's cached
 * cookies, at the cost of one Map lookup per request.
 *
 * Deliberately in-process, like the rate limiter and the digest ticker: the app
 * ships as a single long-lived server container. Both failure modes are safe —
 * a restart empties the map, and a cookie whose stamped version no longer
 * matches is discarded rather than trusted, so at worst a user is asked to
 * re-authenticate. Operators running several server replicas should turn the
 * cookie cache off instead: a bump on replica A is invisible to replica B.
 */

/** Version stamped into cookies for users nobody has revoked. */
const INITIAL_VERSION = 0;

/**
 * How long a bump has to be remembered. Once every cookie signed before the
 * bump has expired on its own, the entry is dead weight — dropping it returns
 * the user to the initial version, which at worst costs one extra database
 * lookup for a cookie that was already invalid.
 */
const RETENTION_MS = 15 * 60 * 1000;

type Revocation = { version: number; prunableAt: number };

const revocations = new Map<string, Revocation>();

function prune(now: number): void {
  for (const [userId, entry] of revocations) {
    if (entry.prunableAt <= now) revocations.delete(userId);
  }
}

/**
 * Invalidates every cached session cookie of `userId`.
 *
 * Call after anything that removes their session rows — ban, session revoke,
 * account deletion, password reset — otherwise the database change is invisible
 * until the cache expires.
 */
export function invalidateCachedSessions(userId: string): void {
  const now = Date.now();
  prune(now);
  const current = revocations.get(userId)?.version ?? INITIAL_VERSION;
  revocations.set(userId, { version: current + 1, prunableAt: now + RETENTION_MS });
}

/** The version Better Auth stamps into, and validates, this user's cookie cache. */
export function cachedSessionVersion(userId: string): string {
  return String(revocations.get(userId)?.version ?? INITIAL_VERSION);
}

/** Test seam — the registry is process-global and would otherwise leak across tests. */
export function resetCachedSessionVersions(): void {
  revocations.clear();
}
