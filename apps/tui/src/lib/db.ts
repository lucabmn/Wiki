import { spawnStream } from "./proc";

/** Host-reachable DSN for the compose Postgres (port 5432 is published). */
export function localDsn(postgresPassword: string): string {
  return `postgresql://postgres:${postgresPassword}@localhost:5432/nilovon-wiki`;
}

/**
 * Apply the Drizzle schema to the running Postgres via the `db:push` script,
 * which uses `packages/db/drizzle.config.ts` (schema paths + `auth`/`wiki`
 * schema filters). Verified to create the schemas from scratch on Postgres 17
 * and 18.
 *
 * Runs from the host against the published port: the `.env` files carry the
 * container-internal `postgres:5432` host, which is not resolvable here, so
 * `DATABASE_URL` is overridden to `localhost`. Verified that this override wins
 * — `dotenv` in the config does not clobber a pre-set env var.
 *
 * `--force` auto-approves (no TTY to confirm on). Push matches how the repo
 * manages its schema; destructive changes on an existing DB apply without a
 * prompt — the same trade-off `db:push` already makes.
 */
export function pushSchema(
  postgresPassword: string,
  onLine?: (line: string) => void,
): Promise<number> {
  return spawnStream(["pnpm", "--filter", "@nilovon-wiki/db", "db:push", "--force"], onLine, {
    env: { DATABASE_URL: localDsn(postgresPassword) },
  });
}
