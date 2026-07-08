import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@nilovon-wiki/db";
import { organization, space, page, pageLink } from "@nilovon-wiki/db/schema/index";

import { syncPageLinks } from "../../src/lib/page-links";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
const now = new Date();

// pglite and node-postgres drizzle instances have identical APIs but distinct
// driver result types; handlers see `context.db` already typed as Database, so
// mirror that here when calling a helper typed for the app db.
const appDb = () => db as unknown as Database;

const outgoing = (sourceId: string) =>
  db
    .select({ target: pageLink.targetPageId })
    .from(pageLink)
    .where(eq(pageLink.sourcePageId, sourceId))
    .orderBy(asc(pageLink.targetPageId))
    .then((rows) => rows.map((r) => r.target));

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(space).values([
    { id: "sp", organizationId: "oA", slug: "sp", name: "SP", createdBy: null },
    { id: "other", organizationId: "oA", slug: "other", name: "Other", createdBy: null },
  ]);
  await db.insert(page).values([
    { id: "p1", spaceId: "sp", slug: "p1", title: "P1" },
    { id: "p2", spaceId: "sp", slug: "p2", title: "P2" },
    { id: "p3", spaceId: "sp", slug: "p3", title: "P3" },
    { id: "pX", spaceId: "other", slug: "px", title: "PX" },
  ]);
});
afterAll(async () => {
  await db.$end();
});

describe("syncPageLinks", () => {
  it("filters out self, other-space, and non-existent targets", async () => {
    await syncPageLinks(appDb(), "p1", "sp", ["p2", "p3", "pX", "ghost", "p1"]);
    expect(await outgoing("p1")).toEqual(["p2", "p3"]);
  });

  it("reconciles to the new target set on the next save", async () => {
    await syncPageLinks(appDb(), "p1", "sp", ["p2"]);
    expect(await outgoing("p1")).toEqual(["p2"]);
  });

  it("clears all links when the target set is empty", async () => {
    await syncPageLinks(appDb(), "p1", "sp", []);
    expect(await outgoing("p1")).toEqual([]);
  });

  it("de-duplicates repeated targets", async () => {
    await syncPageLinks(appDb(), "p1", "sp", ["p2", "p2", "p3", "p3"]);
    expect(await outgoing("p1")).toEqual(["p2", "p3"]);
  });
});
