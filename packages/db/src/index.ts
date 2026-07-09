import { env } from "@nilovon-wiki/env/db";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

/**
 * The application's database handle. Typed without drizzle's `$client` field so
 * downstream packages don't need `@types/pg` on their type surface (avoids the
 * "cannot be named without a reference to 'Pool'" portability error under
 * `composite`/`declaration`).
 */
export type Database = NodePgDatabase<typeof schema>;

export function createDb(): Database {
  return drizzle(env.DATABASE_URL, { schema });
}

// Explicit pool (instead of a connection string) so the process can drain
// connections on shutdown and probe liveness for health checks.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db: Database = drizzle(pool, { schema });

/** Liveness probe for health endpoints — throws when the database is unreachable. */
export async function pingDb(): Promise<void> {
  await pool.query("SELECT 1");
}

/** Drain the shared pool. Call from SIGTERM/SIGINT handlers before exiting. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
