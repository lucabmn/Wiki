import { getAuthTables } from "better-auth/db";
import { describe, expect, it } from "vitest";

import * as schema from "@nilovon-wiki/db/schema/auth";

import { auth } from "../src/index";

/**
 * The Drizzle schema must cover every field Better Auth's plugins declare.
 *
 * This exists because of a real outage-class bug it would have caught: a
 * Better Auth upgrade added `team.memberCount`, the hand-maintained Drizzle
 * schema did not follow, and **creating an organization started failing with a
 * 500** — because creating one also creates its default team. Nothing in the
 * suite saw it: the API integration tests mock `@nilovon-wiki/auth` wholesale,
 * so they never touch the adapter. It surfaced only when the deployment smoke
 * test drove a real stack over HTTP.
 *
 * The check is cheap and total, so it belongs here rather than in the smoke
 * test: a missing field is a broken endpoint, and finding out at boot is much
 * better than finding out from a user.
 *
 * When this fails after a dependency bump, the fix is to add the named field to
 * `packages/db/src/schema/auth.ts` and generate a migration (`pnpm db:generate`)
 * — not to relax the assertion. Regenerating the whole file with
 * `pnpm auth:generate` is the other option, at the cost of a much larger diff.
 */
describe("Better Auth schema coverage", () => {
  it("has a Drizzle column for every field the plugins declare", () => {
    // The Drizzle adapter resolves `schema[modelName][fieldName]`, so the
    // comparison is against JS export and property names — never the SQL
    // identifiers, which are snake_case and would produce nothing but noise.
    const tables = getAuthTables(auth.options as never);
    const missing: string[] = [];

    for (const definition of Object.values(tables) as Array<{
      modelName: string;
      fields: Record<string, { fieldName?: string; required?: boolean; type?: unknown }>;
    }>) {
      const table = (schema as Record<string, unknown>)[definition.modelName];
      if (!table) {
        missing.push(`table ${definition.modelName}`);
        continue;
      }
      const columns = new Set(Object.keys(table as object));
      for (const [field, spec] of Object.entries(definition.fields)) {
        const column = spec.fieldName ?? field;
        if (!columns.has(column)) {
          missing.push(`${definition.modelName}.${column} (required: ${spec.required ?? false})`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
