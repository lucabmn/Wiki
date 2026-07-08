import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@nilovon-wiki/db/schema/index";

const MIGRATION = fileURLToPath(
  new URL("../../../db/src/migrations/0000_vengeful_the_phantom.sql", import.meta.url),
);

export type TestDb = ReturnType<typeof drizzle<typeof schema>> & { $end: () => Promise<void> };

/**
 * Spins up an in-process Postgres (pglite) with the real schema applied by
 * running the generated drizzle migration. Each call is an isolated, empty
 * database — no Docker, no shared state between tests.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const sql = readFileSync(MIGRATION, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) {
      await client.exec(trimmed);
    }
  }
  const db = drizzle(client, { schema }) as TestDb;
  db.$end = () => client.close();
  return db;
}
