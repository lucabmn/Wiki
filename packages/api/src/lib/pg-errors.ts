import { ORPCError } from "@orpc/server";

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * True if `error` (or any error it wraps) is a Postgres unique-constraint
 * violation. Drizzle 0.45 wraps driver errors in a `DrizzleQueryError` whose
 * `cause` is the original `pg` error, so we walk the `cause` chain rather than
 * only inspecting the top-level object.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs `fn`, remapping a Postgres unique-violation into a 409 CONFLICT with
 * `message`. Check-then-insert paths (e.g. {@link uniqueSlug}) are inherently
 * racy: two concurrent creates can both pass the pre-check and then collide on
 * the unique index. Without this the loser surfaces as an opaque 500 instead of
 * a meaningful conflict the client can retry.
 */
export async function mapUniqueViolation<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ORPCError("CONFLICT", { message });
    }
    throw error;
  }
}
