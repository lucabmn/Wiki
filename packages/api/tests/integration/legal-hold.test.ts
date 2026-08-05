import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mutations gate on org permissions; make them controllable and keep the real
// auth module (and its env/db imports) out of the test graph.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  legalHold,
  member,
  organization,
  page,
  space,
  user,
} from "@nilovon-wiki/db/schema/index";

import { runRetention } from "../../src/lib/retention/run";
import { saveRetentionPolicy } from "../../src/lib/retention/settings";
import { legalHoldRouter } from "../../src/routers/legal-hold";
import { pageRouter } from "../../src/routers/page";
import { spaceRouter } from "../../src/routers/space";
import { trashRouter } from "../../src/routers/trash";
import { testContext } from "./context";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
let dbAs: Database;

const now = new Date("2026-08-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const ctx = (org: string | null = "oA") =>
  testContext(db, { userId: "u1", activeOrganizationId: org });

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
  await db.insert(member).values([
    { id: "m1", organizationId: "oA", userId: "u1", role: "owner", createdAt: now },
    { id: "m2", organizationId: "oB", userId: "u1", role: "owner", createdAt: now },
  ]);
});

afterAll(async () => {
  await db.$end();
});

beforeEach(async () => {
  hasPermission.mockClear();
  hasPermission.mockResolvedValue({ success: true });
  await db.delete(legalHold);
  await db.delete(page);
  await db.delete(space);
  await db.delete(activity);
});

/** A public space plus one page in it, both owned by u1. */
async function seedSpaceWithPage(opts: {
  spaceId: string;
  pageId: string;
  organizationId?: string;
  deletedAt?: Date;
}): Promise<void> {
  await db.insert(space).values({
    id: opts.spaceId,
    organizationId: opts.organizationId ?? "oA",
    slug: opts.spaceId,
    name: opts.spaceId,
    visibility: "public",
    createdBy: "u1",
  });
  await db.insert(page).values({
    id: opts.pageId,
    spaceId: opts.spaceId,
    title: opts.pageId,
    slug: opts.pageId,
    status: "published",
    publishedAt: now,
    createdBy: "u1",
    deletedAt: opts.deletedAt ?? null,
  });
}

async function hold(subject: "organization" | "space" | "page", subjectId?: string) {
  return call(
    legalHoldRouter.create,
    { subject, subjectId, reason: "Rechtsstreit Müller vs. Acme" },
    { context: ctx() },
  );
}

describe("a held page", () => {
  beforeEach(async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1" });
  });

  it("refuses the manual delete", async () => {
    await hold("page", "p1");
    // A block that only stopped background jobs would not be a block at all.
    await expect(call(pageRouter.delete, { id: "p1" }, { context: ctx() })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const still = await db.query.page.findFirst({ where: eq(page.id, "p1") });
    expect(still?.deletedAt).toBeNull();
  });

  it("refuses the immediate purge from the trash", async () => {
    await call(pageRouter.delete, { id: "p1" }, { context: ctx() });
    await hold("page", "p1");
    await expect(
      call(trashRouter.purgePage, { id: "p1" }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("survives the trash expiry", async () => {
    await db
      .update(page)
      .set({ deletedAt: daysAgo(90) })
      .where(eq(page.id, "p1"));
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });
    await hold("page", "p1");

    const summary = await runRetention(dbAs, { now });

    expect(summary.pagesPurged).toBe(0);
    expect(summary.heldSkipped).toBeGreaterThanOrEqual(1);
    expect(await db.query.page.findFirst({ where: eq(page.id, "p1") })).toBeDefined();
  });

  it("keeps its audit rows past the audit window", async () => {
    await db.insert(activity).values([
      {
        organizationId: "oA",
        spaceId: "sA",
        pageId: "p1",
        action: "page.updated",
        createdAt: daysAgo(400),
      },
      { organizationId: "oA", spaceId: "sA", action: "page.updated", createdAt: daysAgo(400) },
    ]);
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 30, trashRetentionDays: 30 });
    await hold("page", "p1");

    await runRetention(dbAs, { now });

    const survivors = await db.query.activity.findMany({
      where: eq(activity.action, "page.updated"),
    });
    // The page's own row is protected; the space-only row is not.
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.pageId).toBe("p1");
  });

  it("blocks deleting the space it lives in", async () => {
    await hold("page", "p1");
    await expect(call(spaceRouter.delete, { id: "sA" }, { context: ctx() })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("lets the windows apply again once released", async () => {
    const created = await hold("page", "p1");
    await call(
      legalHoldRouter.release,
      { id: created.id, reason: "Verfahren abgeschlossen" },
      { context: ctx() },
    );

    await db
      .update(page)
      .set({ deletedAt: daysAgo(90) })
      .where(eq(page.id, "p1"));
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });
    const summary = await runRetention(dbAs, { now });

    expect(summary.pagesPurged).toBe(1);
    expect(await db.query.page.findFirst({ where: eq(page.id, "p1") })).toBeUndefined();
  });
});

describe("a hold on a space", () => {
  it("protects its pages, their deletion and their audit rows", async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1" });
    await db.insert(activity).values({
      organizationId: "oA",
      spaceId: "sA",
      pageId: "p1",
      action: "page.updated",
      createdAt: daysAgo(400),
    });
    await hold("space", "sA");

    // Inheritance is implemented, not assumed: the page carries no hold of its
    // own, yet every path that would remove it has to refuse.
    await expect(call(pageRouter.delete, { id: "p1" }, { context: ctx() })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(call(spaceRouter.delete, { id: "sA" }, { context: ctx() })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: 30, trashRetentionDays: 30 });
    await runRetention(dbAs, { now });
    expect(
      await db.query.activity.findMany({ where: eq(activity.action, "page.updated") }),
    ).toHaveLength(1);
  });

  it("keeps an already-trashed space from expiring", async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1" });
    await db
      .update(space)
      .set({ deletedAt: daysAgo(90) })
      .where(eq(space.id, "sA"));
    await hold("space", "sA");
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });

    const summary = await runRetention(dbAs, { now });

    expect(summary.spacesPurged).toBe(0);
    expect(await db.query.space.findFirst({ where: eq(space.id, "sA") })).toBeDefined();
  });
});

describe("organization scoping", () => {
  it("does not let one organization's hold protect another's data", async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1", organizationId: "oA" });
    await seedSpaceWithPage({ spaceId: "sB", pageId: "p2", organizationId: "oB" });
    // A blanket hold on oA — the bluntest instrument there is.
    await hold("organization");

    await db
      .update(page)
      .set({ deletedAt: daysAgo(90) })
      .where(eq(page.id, "p1"));
    await db
      .update(page)
      .set({ deletedAt: daysAgo(90) })
      .where(eq(page.id, "p2"));
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });
    await saveRetentionPolicy(dbAs, "oB", { auditRetentionDays: null, trashRetentionDays: 30 });

    await runRetention(dbAs, { now });

    expect(await db.query.page.findFirst({ where: eq(page.id, "p1") })).toBeDefined();
    expect(await db.query.page.findFirst({ where: eq(page.id, "p2") })).toBeUndefined();
  });

  it("refuses a hold naming a space in a different organization", async () => {
    await seedSpaceWithPage({ spaceId: "sB", pageId: "p2", organizationId: "oB" });
    await expect(hold("space", "sB")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("audit trail", () => {
  it("records setting and releasing as two events, each with its reason", async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1" });
    const created = await hold("page", "p1");
    await call(
      legalHoldRouter.release,
      { id: created.id, reason: "Freigabe durch Rechtsabteilung" },
      { context: ctx() },
    );

    const rows = await db.query.activity.findMany();
    const set = rows.find((row) => row.action === "hold.created");
    const released = rows.find((row) => row.action === "hold.released");
    expect(set?.metadata).toMatchObject({ reason: "Rechtsstreit Müller vs. Acme" });
    expect(released?.metadata).toMatchObject({ reason: "Freigabe durch Rechtsabteilung" });

    // The row itself is kept, not deleted: that a hold once existed is evidence.
    const stored = await db.query.legalHold.findFirst({ where: eq(legalHold.id, created.id) });
    expect(stored?.releasedAt).toBeInstanceOf(Date);
    expect(stored?.releaseReason).toBe("Freigabe durch Rechtsabteilung");
  });

  it("refuses a second active hold on the same object, and a double release", async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1" });
    const created = await hold("page", "p1");
    await expect(hold("page", "p1")).rejects.toMatchObject({ code: "CONFLICT" });

    await call(legalHoldRouter.release, { id: created.id, reason: "fertig" }, { context: ctx() });
    await expect(
      call(legalHoldRouter.release, { id: created.id, reason: "nochmal" }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Released, so the object may be held again.
    await expect(hold("page", "p1")).resolves.toMatchObject({ subjectId: "p1" });
  });

  it("reports the innermost block so the UI can explain the refusal", async () => {
    await seedSpaceWithPage({ spaceId: "sA", pageId: "p1" });
    await hold("space", "sA");
    const viaSpace = await call(legalHoldRouter.status, { pageId: "p1" }, { context: ctx() });
    expect(viaSpace).toMatchObject({ held: true, source: "space" });

    await hold("page", "p1");
    const viaPage = await call(legalHoldRouter.status, { pageId: "p1" }, { context: ctx() });
    expect(viaPage).toMatchObject({ held: true, source: "page" });
  });
});
