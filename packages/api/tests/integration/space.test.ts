import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively. Reads don't touch this; only mutations do.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  attachment,
  organization,
  user,
  member,
  space,
  spaceMember,
  team,
  teamMember,
} from "@nilovon-wiki/db/schema/index";

import { setStorage } from "../../src/lib/storage";
import { spaceRouter } from "../../src/routers/space";
import { trashRouter } from "../../src/routers/trash";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
let storage: Files;
const now = new Date();

beforeAll(async () => {
  db = await createTestDb();
  // Two orgs, one user who is a member of org A only.
  await db.insert(user).values([
    { id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now },
    { id: "u2", name: "B", email: "b@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "OrgA", slug: "orga", createdAt: now },
    { id: "oB", name: "OrgB", slug: "orgb", createdAt: now },
  ]);
  await db.insert(member).values({ id: "mA", organizationId: "oA", userId: "u1", createdAt: now });
});
afterAll(async () => {
  setStorage(null);
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockClear();
  hasPermission.mockResolvedValue({ success: true });
  storage = new Files({ adapter: memory() });
  setStorage(storage);
});

const ctx = (userId = "u1", org: string | null = "oA") =>
  testContext(db, { userId, activeOrganizationId: org });

describe("space.create", () => {
  it("creates a space and grants the creator admin membership", async () => {
    const created = await call(
      spaceRouter.create,
      { name: "Engineering", visibility: "private" },
      { context: ctx() },
    );
    expect(created.slug).toBe("engineering");
    expect(created.createdBy).toBe("u1");

    const membership = await db.query.spaceMember.findFirst({
      where: and(eq(spaceMember.spaceId, created.id), eq(spaceMember.userId, "u1")),
    });
    expect(membership?.role).toBe("admin");

    // An activity row was emitted in the same transaction.
    const acts = await db.query.activity.findMany();
    expect(acts.some((a) => a.action === "space.created" && a.spaceId === created.id)).toBe(true);
  });
});

describe("space.get visibility gating", () => {
  it("allows any org member to read a public space", async () => {
    await db.insert(space).values({
      id: "sp-pub",
      organizationId: "oA",
      slug: "pub",
      name: "Public",
      visibility: "public",
      createdBy: "u2",
    });
    const got = await call(spaceRouter.get, { id: "sp-pub" }, { context: ctx() });
    expect(got.id).toBe("sp-pub");
  });

  it("denies a non-member reading a private space, allows an explicit member", async () => {
    await db.insert(space).values({
      id: "sp-priv",
      organizationId: "oA",
      slug: "priv",
      name: "Private",
      visibility: "private",
      createdBy: "u2",
    });
    // u1 is not a space member yet -> FORBIDDEN
    await expect(
      call(spaceRouter.get, { id: "sp-priv" }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await db.insert(spaceMember).values({
      id: "smp",
      spaceId: "sp-priv",
      subject: "user",
      userId: "u1",
      role: "editor",
    });
    const got = await call(spaceRouter.get, { id: "sp-priv" }, { context: ctx() });
    expect(got.id).toBe("sp-priv");
  });

  it("grants private-space access via team membership", async () => {
    await db.insert(team).values({ id: "t1", name: "Team", organizationId: "oA", createdAt: now });
    await db.insert(teamMember).values({ id: "tm1", teamId: "t1", userId: "u1", createdAt: now });
    await db.insert(space).values({
      id: "sp-team",
      organizationId: "oA",
      slug: "team",
      name: "TeamSpace",
      visibility: "private",
      createdBy: "u2",
    });
    await db.insert(spaceMember).values({
      id: "smt",
      spaceId: "sp-team",
      subject: "team",
      teamId: "t1",
      role: "viewer",
    });
    const got = await call(spaceRouter.get, { id: "sp-team" }, { context: ctx() });
    expect(got.id).toBe("sp-team");
  });

  it("allows the creator to read a restricted space without an explicit member row", async () => {
    await db.insert(space).values({
      id: "sp-restr",
      organizationId: "oA",
      slug: "restr",
      name: "Restricted",
      visibility: "restricted",
      createdBy: "u1",
    });
    const got = await call(spaceRouter.get, { id: "sp-restr" }, { context: ctx() });
    expect(got.id).toBe("sp-restr");
  });

  it("denies cross-org reads even for a public space", async () => {
    await db.insert(space).values({
      id: "sp-orgb",
      organizationId: "oB",
      slug: "b",
      name: "OrgB Space",
      visibility: "public",
      createdBy: "u2",
    });
    // u1's active org is oA; the space lives in oB -> FORBIDDEN
    await expect(
      call(spaceRouter.get, { id: "sp-orgb" }, { context: ctx("u1", "oA") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("space.delete (soft delete into the trash)", () => {
  it("moves the space to the trash instead of destroying it", async () => {
    const created = await call(
      spaceRouter.create,
      { name: "Doomed", visibility: "public" },
      { context: ctx() },
    );
    await call(spaceRouter.delete, { id: created.id }, { context: ctx() });

    // The row survives — this is the whole point of the change: "Delete space"
    // used to be the one button that could destroy a year of writing.
    const trashed = await db.query.space.findFirst({ where: eq(space.id, created.id) });
    expect(trashed?.deletedAt).toBeInstanceOf(Date);
    expect(trashed?.deletedBy).toBe("u1");
    // ...and it drops out of the normal listing.
    const list = await call(spaceRouter.list, { includeArchived: true }, { context: ctx() });
    expect(list.map((s) => s.id)).not.toContain(created.id);

    // The audit row still carries the identifying metadata, because the purge
    // that eventually removes the row nulls `activity.spaceId`.
    const acts = await db.query.activity.findMany();
    const deleted = acts.find(
      (a) =>
        a.action === "space.deleted" &&
        (a.metadata as { spaceId?: string } | null)?.spaceId === created.id,
    );
    expect(deleted?.metadata).toMatchObject({ spaceId: created.id, name: "Doomed" });
  });

  it("keeps the space and attachment metadata when object deletion fails on purge", async () => {
    const created = await call(
      spaceRouter.create,
      { name: "Retryable", visibility: "public" },
      { context: ctx() },
    );
    const storageKey = `spaces/${created.id}/file.pdf`;
    await storage.upload(storageKey, new Blob(["hello"]));
    await db.insert(attachment).values({
      id: "attachment-to-retry",
      spaceId: created.id,
      fileName: "file.pdf",
      mimeType: "application/pdf",
      size: 5,
      storageKey,
      uploadedBy: "u1",
    });
    await call(spaceRouter.delete, { id: created.id }, { context: ctx() });
    vi.spyOn(storage, "delete").mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      call(trashRouter.purgeSpace, { id: created.id }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    const survivingSpace = await db.query.space.findFirst({ where: eq(space.id, created.id) });
    const survivingAttachment = await db.query.attachment.findFirst({
      where: eq(attachment.id, "attachment-to-retry"),
    });
    expect(survivingSpace?.deletionPendingAt).toBeInstanceOf(Date);
    expect(survivingAttachment?.deletionPendingAt).toBeInstanceOf(Date);
    expect(await storage.exists(storageKey)).toBe(true);

    // Repeating the purge resumes the cleanup: bytes first, then the rows.
    await call(trashRouter.purgeSpace, { id: created.id }, { context: ctx() });
    expect(await db.query.space.findFirst({ where: eq(space.id, created.id) })).toBeUndefined();
    expect(
      await db.query.attachment.findFirst({ where: eq(attachment.id, "attachment-to-retry") }),
    ).toBeUndefined();
    expect(await storage.exists(storageKey)).toBe(false);

    const acts = await db.query.activity.findMany();
    const purged = acts.find(
      (a) =>
        a.action === "space.purged" &&
        (a.metadata as { spaceId?: string } | null)?.spaceId === created.id,
    );
    // `activity.spaceId` nulls with the space, so the identity lives in metadata.
    expect(purged?.spaceId).toBeNull();
    expect(purged?.metadata).toMatchObject({ spaceId: created.id, name: "Retryable" });
  });

  it("restores a trashed space, uploads included", async () => {
    const created = await call(
      spaceRouter.create,
      { name: "Second Thoughts", visibility: "public" },
      { context: ctx() },
    );
    await call(spaceRouter.delete, { id: created.id }, { context: ctx() });
    await call(trashRouter.restoreSpace, { id: created.id }, { context: ctx() });

    const restored = await db.query.space.findFirst({ where: eq(space.id, created.id) });
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.deletionPendingAt).toBeNull();
    const list = await call(spaceRouter.list, { includeArchived: false }, { context: ctx() });
    expect(list.map((s) => s.id)).toContain(created.id);
  });

  it("un-archives a space via space.restore", async () => {
    const created = await call(
      spaceRouter.create,
      { name: "Dormant", visibility: "public" },
      { context: ctx() },
    );
    await call(spaceRouter.archive, { id: created.id }, { context: ctx() });
    expect(
      (await call(spaceRouter.list, { includeArchived: false }, { context: ctx() })).map(
        (s) => s.id,
      ),
    ).not.toContain(created.id);

    const restored = await call(spaceRouter.restore, { id: created.id }, { context: ctx() });
    expect(restored.archivedAt).toBeNull();
    expect(
      (await call(spaceRouter.list, { includeArchived: false }, { context: ctx() })).map(
        (s) => s.id,
      ),
    ).toContain(created.id);
  });
});

describe("space.list", () => {
  it("returns only spaces the caller can read", async () => {
    const list = await call(spaceRouter.list, { includeArchived: false }, { context: ctx() });
    const ids = list.map((s) => s.id);
    // readable: public, the private ones u1 was added to, restricted (creator)
    expect(ids).toContain("sp-pub");
    expect(ids).toContain("sp-priv");
    expect(ids).toContain("sp-team");
    expect(ids).toContain("sp-restr");
    // never a different org's space
    expect(ids).not.toContain("sp-orgb");
  });
});
