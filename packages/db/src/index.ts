import { env } from "@nilovon-wiki/env/server";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

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

export const db: Database = createDb();
