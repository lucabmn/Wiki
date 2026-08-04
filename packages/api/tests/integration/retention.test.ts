import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  member,
  organization,
  organizationRetentionSetting,
  space,
  user,
} from "@nilovon-wiki/db/schema/index";

import { runRetention } from "../../src/lib/retention/run";
import { saveRetentionPolicy } from "../../src/lib/retention/settings";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
/**
 * The same handle, typed for the production signatures. pglite and node-postgres
 * differ only in the driver generic, so the suite casts once instead of threading
 * a generic through the data layer (the digest suite does the same).
 */
let dbAs: Database;

const now = new Date("2026-08-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  db = await createTestDb();
  dbAs = db as unknown as Database;
  await db
    .insert(user)
    .values({ id: "u1", name: "Ada", email: "ada@x.io", createdAt: now, updatedAt: now });
  await db.insert(organization).values([
    { id: "oA", name: "Acme", slug: "acme", createdAt: now },
    { id: "oB", name: "Other", slug: "other", createdAt: now },
  ]);
  await db
    .insert(member)
    .values({ id: "m1", organizationId: "oA", userId: "u1", role: "owner", createdAt: now });
  await db.insert(space).values({
    id: "sA",
    organizationId: "oA",
    slug: "a",
    name: "Space A",
    visibility: "public",
    createdBy: "u1",
  });
});

afterAll(async () => {
  await db.$end();
});

beforeEach(async () => {
  await db.delete(activity);
  await db.delete(organizationRetentionSetting);
});

/** Seeds `n` audit rows at a given age, all purgeable (a non-protected action). */
async function seedAudit(count: number, ageDays: number, organizationId = "oA"): Promise<void> {
  const createdAt = daysAgo(ageDays);
  await db.insert(activity).values(
    Array.from({ length: count }, () => ({
      organizationId,
      action: "page.updated" as const,
      createdAt,
    })),
  );
}

async function auditCount(organizationId = "oA"): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(activity)
    .where(and(eq(activity.organizationId, organizationId), eq(activity.action, "page.updated")));
  return rows[0]?.n ?? 0;
}

describe("audit retention window", () => {
  it("deletes nothing when the window is null (keep forever)", async () => {
    await seedAudit(5, 400);
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });

    const summary = await runRetention(dbAs, { now });

    expect(summary.auditDeleted).toBe(0);
    expect(await auditCount()).toBe(5);
  });

  it("deletes rows older than the window and keeps younger ones", async () => {
    await seedAudit(3, 100); // older than 90 days
    await seedAudit(4, 10); // well inside the window
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 90, trashRetentionDays: 30 });

    const summary = await runRetention(dbAs, { now });

    expect(summary.auditDeleted).toBe(3);
    expect(await auditCount()).toBe(4);
  });

  it("never removes the audit row that records the policy change itself", async () => {
    // The governance events are exempt: shortening the window to a week must not,
    // a week later, erase the only record of who shortened it.
    await db.insert(activity).values([
      { organizationId: "oA", action: "retention.updated", createdAt: daysAgo(400) },
      { organizationId: "oA", action: "hold.created", createdAt: daysAgo(400) },
      { organizationId: "oA", action: "hold.released", createdAt: daysAgo(400) },
      { organizationId: "oA", action: "retention.purged", createdAt: daysAgo(400) },
    ]);
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 7, trashRetentionDays: 30 });

    await runRetention(dbAs, { now });

    const survivors = await db.query.activity.findMany({
      where: eq(activity.organizationId, "oA"),
    });
    expect(survivors.map((row) => row.action).sort()).toEqual([
      "hold.created",
      "hold.released",
      "retention.purged",
      "retention.updated",
    ]);
  });

  it("respects the batch ceiling and finishes the rest on the next run", async () => {
    await seedAudit(12, 100);
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 30, trashRetentionDays: 30 });

    const first = await runRetention(dbAs, { now, batchLimit: 5 });
    expect(first.auditDeleted).toBe(5);
    expect(first.batchLimitReached).toBe(true);
    expect(await auditCount()).toBe(7);

    const second = await runRetention(dbAs, { now, batchLimit: 5 });
    expect(second.auditDeleted).toBe(5);
    expect(await auditCount()).toBe(2);

    const third = await runRetention(dbAs, { now, batchLimit: 5 });
    expect(third.auditDeleted).toBe(2);
    expect(third.batchLimitReached).toBe(false);
    expect(await auditCount()).toBe(0);
  });

  it("does not reach into another organization's log", async () => {
    await seedAudit(3, 400, "oB");
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 1, trashRetentionDays: 30 });
    // oB gets a row with the default policy (keep forever) from the runner.

    await runRetention(dbAs, { now });

    expect(await auditCount("oB")).toBe(3);
  });
});

describe("concurrent runs", () => {
  it("does not delete twice when two runs overlap", async () => {
    await seedAudit(10, 100);
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 30, trashRetentionDays: 30 });

    // Started together, the two runs race on the claim. Exactly one owns each
    // organization, so the totals add up to the rows that existed — not double.
    const [a, b] = await Promise.all([
      runRetention(dbAs, { now, batchLimit: 100 }),
      runRetention(dbAs, { now, batchLimit: 100 }),
    ]);

    expect(a.auditDeleted + b.auditDeleted).toBe(10);
    // One of them found the org already claimed and skipped it.
    expect(a.skippedClaimed + b.skippedClaimed).toBeGreaterThanOrEqual(1);
    expect(await auditCount()).toBe(0);
  });

  it("reclaims an organization whose previous run died holding the claim", async () => {
    await seedAudit(2, 100);
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 30, trashRetentionDays: 30 });
    // A crashed run leaves the claim behind; the lease is what stops that from
    // freezing the organization forever.
    await db
      .update(organizationRetentionSetting)
      .set({ purgeClaimedAt: daysAgo(1) })
      .where(eq(organizationRetentionSetting.organizationId, "oA"));

    const stillClaimed = await runRetention(dbAs, { now, leaseMs: 7 * 24 * 60 * 60 * 1000 });
    expect(stillClaimed.auditDeleted).toBe(0);
    expect(stillClaimed.skippedClaimed).toBeGreaterThanOrEqual(1);

    const reclaimed = await runRetention(dbAs, { now, leaseMs: 60 * 1000 });
    expect(reclaimed.auditDeleted).toBe(2);
  });

  it("releases its claim and stamps lastPurgeAt when it is done", async () => {
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 30, trashRetentionDays: 30 });
    await runRetention(dbAs, { now });

    const row = await db.query.organizationRetentionSetting.findFirst({
      where: eq(organizationRetentionSetting.organizationId, "oA"),
    });
    expect(row?.purgeClaimedAt).toBeNull();
    expect(row?.lastPurgeAt).toEqual(now);
  });
});

describe("policy defaults", () => {
  it("gives every organization a row so its trash can expire", async () => {
    await runRetention(dbAs, { now });
    const rows = await db.query.organizationRetentionSetting.findMany();
    expect(rows.map((row) => row.organizationId).sort()).toEqual(["oA", "oB"]);
    // Unlimited audit retention, 30-day trash — the documented defaults.
    expect(rows.every((row) => row.auditRetentionDays === null)).toBe(true);
    expect(rows.every((row) => row.trashRetentionDays === 30)).toBe(true);
  });
});
