import { ORPCError } from "@orpc/server";

/**
 * Unwraps the single row from a drizzle `.returning()` result. An insert/update
 * that reached this point produced exactly one row, so a missing row is an
 * invariant violation, not a client error.
 */
export function firstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Expected a row to be returned",
    });
  }
  return row;
}
