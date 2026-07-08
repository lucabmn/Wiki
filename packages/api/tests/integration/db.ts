import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@nilovon-wiki/db/schema/index";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/src/migrations", import.meta.url));

export type TestDb = ReturnType<typeof drizzle<typeof schema>> & { $end: () => Promise<void> };

/**
 * Spins up an in-process Postgres (pglite) with the real schema applied by
 * running every generated drizzle migration in order. Each call is an
 * isolated, empty database — no Docker, no shared state between tests.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    const sql = readFileSync(join(MIGRATIONS_DIR, migration), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) {
        await client.exec(trimmed);
      }
    }
  }
  const db = drizzle(client, { schema }) as TestDb;
  db.$end = () => client.close();
  return db;
}
