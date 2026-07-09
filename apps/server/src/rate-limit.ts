import type { MiddlewareHandler } from "hono";

/**
 * Fixed-window, per-IP rate limiter held in process memory.
 *
 * Deliberately dependency-free and single-instance: this server ships as one
 * container per install, so a shared store (Redis) would add an operational
 * dependency for no benefit. If the deployment ever scales horizontally, swap
 * the Map for a shared backend behind the same middleware.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

export function rateLimit(options: { max: number; keyPrefix: string }): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  // Drop expired buckets so long-running processes don't accumulate one entry
  // per client IP forever. `unref` keeps the timer from holding the process open.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, WINDOW_MS);
  sweeper.unref?.();

  return async (c, next) => {
    // Behind the bundled Caddy proxy the client address arrives via
    // X-Forwarded-For; when exposed directly there is no trustworthy header,
    // so all unattributed traffic shares one generous bucket.
    const forwarded = c.req.header("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    const key = `${options.keyPrefix}:${ip}`;

    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, options.max - bucket.count);
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    c.header("RateLimit-Limit", String(options.max));
    c.header("RateLimit-Remaining", String(remaining));
    c.header("RateLimit-Reset", String(resetSeconds));

    if (bucket.count > options.max) {
      c.header("Retry-After", String(resetSeconds));
      return c.json({ error: "Too many requests" }, 429);
    }

    await next();
  };
}
