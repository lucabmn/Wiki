import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  attachment,
  favorite,
  member,
  organization,
  organizationDigestSetting,
  page,
  pageLink,
  space,
  user,
} from "@nilovon-wiki/db/schema/index";

import { collectDigest } from "../../src/lib/notifications/collect";
import { ORGANIZATION_DIGEST_DEFAULTS } from "../../src/lib/notifications/settings";
import { runRetention } from "../../src/lib/retention/run";
import { saveRetentionPolicy } from "../../src/lib/retention/settings";
import { setStorage } from "../../src/lib/storage";
import { linkRouter } from "../../src/routers/link";
import { pageRouter } from "../../src/routers/page";
import { searchRouter } from "../../src/routers/search";
import { trashRouter } from "../../src/routers/trash";
import { userStateRouter } from "../../src/routers/user-state";
import { testContext } from "./context";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
let dbAs: Database;
let storage: Files;

const now = new Date("2026-08-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const ctx = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  dbAs = db as unknown as Database;
  await db
    .insert(user)
    .values({ id: "u1", name: "Ada", email: "ada@x.io", createdAt: now, updatedAt: now });
  await db.insert(organization).values({ id: "oA", name: "Acme", slug: "acme", createdAt: now });
  await db
    .insert(member)
    .values({ id: "m1", organizationId: "oA", userId: "u1", role: "owner", createdAt: now });
  await db.insert(organizationDigestSetting).values({ organizationId: "oA" });
});

afterAll(async () => {
  setStorage(null);
  await db.$end();
});

beforeEach(async () => {
  hasPermission.mockClear();
  hasPermission.mockResolvedValue({ success: true });
  storage = new Files({ adapter: memory() });
  setStorage(storage);
  await db.delete(pageLink);
  await db.delete(favorite);
  await db.delete(attachment);
  await db.delete(page);
  await db.delete(space);
  await db.delete(activity);
});

/**
 * A space with a published "target" page and a published "linker" page pointing
 * at it — enough to exercise every view the ticket names in one fixture.
 */
async function seed(): Promise<void> {
  await db.insert(space).values({
    id: "sA",
    organizationId: "oA",
    slug: "a",
    name: "Space A",
    visibility: "public",
    createdBy: "u1",
  });
  await db.insert(page).values([
    {
      id: "target",
      spaceId: "sA",
      title: "Zielseite",
      slug: "zielseite",
      textContent: "Aufbewahrung und Papierkorb",
      status: "published",
      publishedAt: now,
      createdBy: "u1",
    },
    {
      id: "linker",
      spaceId: "sA",
      title: "Verweisseite",
      slug: "verweisseite",
      textContent: "verweist",
      status: "published",
      publishedAt: now,
      createdBy: "u1",
    },
  ]);
  await db.insert(pageLink).values({ sourcePageId: "linker", targetPageId: "target" });
  await db.insert(favorite).values({ userId: "u1", pageId: "target" });
  await db.insert(activity).values({
    organizationId: "oA",
    spaceId: "sA",
    pageId: "target",
    action: "page.published",
    createdAt: new Date(now.getTime() - 60_000),
  });
}

const listPages = () =>
  call(pageRouter.list, { spaceId: "sA", includeArchived: false }, { context: ctx() });
const search = () =>
  call(searchRouter.pages, { query: "Aufbewahrung", limit: 10 }, { context: ctx() });
const backlinks = () => call(linkRouter.backlinks, { id: "target" }, { context: ctx() });
const favorites = () => call(userStateRouter.listFavorites, {}, { context: ctx() });
const digest = () =>
  collectDigest(dbAs, {
    userId: "u1",
    organizationId: "oA",
    preferences: { ...ORGANIZATION_DIGEST_DEFAULTS, includeOwnActivity: true },
    from: new Date(now.getTime() - 3_600_000),
    to: now,
  });

describe("a deleted page disappears from every view", () => {
  beforeEach(async () => {
    await seed();
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });
  });

  it("is gone from pages.list", async () => {
    expect((await listPages()).map((row) => row.id)).toEqual(["linker"]);
  });

  it("is gone from search", async () => {
    expect(await search()).toEqual([]);
  });

  it("is gone from backlinks", async () => {
    // Asked from the other side: the deleted page no longer *is* a backlink.
    expect((await call(linkRouter.backlinks, { id: "linker" }, { context: ctx() })).length).toBe(0);
  });

  it("is gone from favorites", async () => {
    expect(await favorites()).toEqual([]);
  });

  it("is gone from the digest collection", async () => {
    const { entries } = await digest();
    expect(entries.some((entry) => entry.pageId === "target")).toBe(false);
  });

  it("is gone from pages.get and the page's own trash-free API", async () => {
    await expect(call(pageRouter.get, { id: "target" }, { context: ctx() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("restoring brings it back everywhere", () => {
  it("returns to the list, search, backlinks, favorites and the digest", async () => {
    await seed();
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });
    await call(trashRouter.restorePage, { id: "target" }, { context: ctx() });

    expect((await listPages()).map((row) => row.id).sort()).toEqual(["linker", "target"]);
    expect((await search()).map((hit) => hit.pageId)).toEqual(["target"]);
    expect((await backlinks()).map((row) => row.id)).toEqual(["linker"]);
    expect((await favorites()).map((row) => row.id)).toEqual(["target"]);
    const { entries } = await digest();
    expect(entries.some((entry) => entry.pageId === "target")).toBe(true);
  });

  it("takes the whole subtree with it, in both directions", async () => {
    await seed();
    await db.insert(page).values({
      id: "child",
      spaceId: "sA",
      parentId: "target",
      title: "Unterseite",
      slug: "unterseite",
      status: "published",
      publishedAt: now,
      createdBy: "u1",
    });

    const deleted = await call(pageRouter.delete, { id: "target" }, { context: ctx() });
    expect(deleted.deleted).toBe(2);
    // A child left behind would be stranded under a parent no reader can open.
    expect(
      (await db.query.page.findFirst({ where: eq(page.id, "child") }))?.deletedAt,
    ).toBeInstanceOf(Date);

    const restored = await call(trashRouter.restorePage, { id: "target" }, { context: ctx() });
    expect(restored.restored).toBe(2);
    expect((await db.query.page.findFirst({ where: eq(page.id, "child") }))?.deletedAt).toBeNull();
  });
});

describe("archived and deleted are different states", () => {
  it("coexist: archiving then deleting, and restoring puts it back archived", async () => {
    await seed();
    await call(pageRouter.archive, { id: "target" }, { context: ctx() });
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });

    const trashed = await db.query.page.findFirst({ where: eq(page.id, "target") });
    // Both markers set; neither overwrote the other.
    expect(trashed?.archivedAt).toBeInstanceOf(Date);
    expect(trashed?.deletedAt).toBeInstanceOf(Date);
    expect(trashed?.status).toBe("archived");

    await call(trashRouter.restorePage, { id: "target" }, { context: ctx() });
    const restored = await db.query.page.findFirst({ where: eq(page.id, "target") });
    // Restoring from the trash returns the page to the state its author left it
    // in — archived — and does not silently un-archive it.
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.archivedAt).toBeInstanceOf(Date);
    // An archived page is still findable by an explicit request; a deleted one
    // is not findable at all. That is the distinction.
    const withArchived = await call(
      pageRouter.list,
      { spaceId: "sA", includeArchived: true },
      { context: ctx() },
    );
    expect(withArchived.map((row) => row.id).sort()).toEqual(["linker", "target"]);
  });

  it("an archived page is never treated as trash by the expiry sweep", async () => {
    await seed();
    await db
      .update(page)
      .set({ archivedAt: daysAgo(400) })
      .where(eq(page.id, "target"));
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });

    const summary = await runRetention(dbAs, { now });

    expect(summary.pagesPurged).toBe(0);
    expect(await db.query.page.findFirst({ where: eq(page.id, "target") })).toBeDefined();
  });
});

describe("expiry removes the row and its objects", () => {
  it("deletes the page and its S3 objects once the window has passed", async () => {
    await seed();
    const storageKey = "spaces/sA/attachment.pdf";
    await storage.upload(storageKey, new Blob(["bytes"]));
    await db.insert(attachment).values({
      id: "a1",
      spaceId: "sA",
      pageId: "target",
      fileName: "attachment.pdf",
      mimeType: "application/pdf",
      size: 5,
      storageKey,
      uploadedBy: "u1",
    });
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });
    await db
      .update(page)
      .set({ deletedAt: daysAgo(90) })
      .where(eq(page.id, "target"));
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });

    const summary = await runRetention(dbAs, { now });

    expect(summary.pagesPurged).toBe(1);
    expect(summary.attachmentsPurged).toBe(1);
    expect(await db.query.page.findFirst({ where: eq(page.id, "target") })).toBeUndefined();
    expect(await db.query.attachment.findFirst({ where: eq(attachment.id, "a1") })).toBeUndefined();
    // Without this the bucket would grow forever: `attachment.pageId` nulls on
    // delete rather than cascading, so nothing else would ever collect the bytes.
    expect(await storage.exists(storageKey)).toBe(false);
  });

  it("leaves a page inside the window alone", async () => {
    await seed();
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 30 });

    const summary = await runRetention(dbAs, { now });

    expect(summary.pagesPurged).toBe(0);
    expect(await db.query.page.findFirst({ where: eq(page.id, "target") })).toBeDefined();
  });
});

describe("the trash view", () => {
  it("lists what is in it, who deleted it and when it expires", async () => {
    await seed();
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });
    await saveRetentionPolicy(dbAs, "oA", { auditRetentionDays: null, trashRetentionDays: 14 });

    const rows = await call(trashRouter.listPages, { spaceId: "sA" }, { context: ctx() });

    expect(rows).toHaveLength(1);
    const entry = rows[0]!;
    expect(entry.id).toBe("target");
    expect(entry.deletedBy).toBe("u1");
    expect(entry.held).toBe(false);
    expect(entry.expiresAt.getTime() - entry.deletedAt.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("purges on request without waiting for the window", async () => {
    await seed();
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });

    await call(trashRouter.purgePage, { id: "target" }, { context: ctx() });

    expect(await db.query.page.findFirst({ where: eq(page.id, "target") })).toBeUndefined();
    const acts = await db.query.activity.findMany({ where: eq(activity.action, "page.purged") });
    expect(acts[0]?.metadata).toMatchObject({ pageId: "target", title: "Zielseite" });
  });

  it("refuses to purge a page that is not in the trash", async () => {
    await seed();
    await expect(
      call(trashRouter.purgePage, { id: "target" }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to restore a page whose space is itself trashed", async () => {
    await seed();
    await call(pageRouter.delete, { id: "target" }, { context: ctx() });
    await db.update(space).set({ deletedAt: now }).where(eq(space.id, "sA"));

    await expect(
      call(trashRouter.restorePage, { id: "target" }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("a trashed space hides its pages", () => {
  it("keeps them out of every view without stamping them individually", async () => {
    await seed();
    await db.update(space).set({ deletedAt: now, deletedBy: "u1" }).where(eq(space.id, "sA"));

    // Not stamped: restore has to be able to tell which pages were deleted on
    // their own before the space went, so the space's state is consulted instead.
    expect((await db.query.page.findFirst({ where: eq(page.id, "target") }))?.deletedAt).toBeNull();
    await expect(call(pageRouter.get, { id: "target" }, { context: ctx() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await search()).toEqual([]);
    expect(await favorites()).toEqual([]);
    const { entries } = await digest();
    expect(entries.some((entry) => entry.pageId === "target")).toBe(false);
  });
});
