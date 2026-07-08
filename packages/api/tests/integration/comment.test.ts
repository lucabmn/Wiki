import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively. Reads don't touch this; only mutations do.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, space, page, comment } from "@nilovon-wiki/db/schema/index";

import { commentRouter } from "../../src/routers/comment";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId = "u1") => testContext(db, { userId, activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now },
    { id: "u2", name: "B", email: "b@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values([
    { id: "mA", organizationId: "oA", userId: "u1", createdAt: now },
    { id: "mB", organizationId: "oA", userId: "u2", createdAt: now },
  ]);
  await db.insert(space).values({
    id: "sp",
    organizationId: "oA",
    slug: "docs",
    name: "Docs",
    visibility: "public",
    createdBy: "u1",
  });
  await db.insert(page).values({ id: "pg", spaceId: "sp", slug: "notes", title: "Notes" });
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
});

describe("comment.delete", () => {
  it("soft-deletes the author's own comment and records comment.deleted", async () => {
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "hello" },
      { context: ctx() },
    );
    const res = await call(commentRouter.delete, { id: created.id }, { context: ctx() });
    expect(res.id).toBe(created.id);

    const row = await db.query.comment.findFirst({ where: eq(comment.id, created.id) });
    expect(row?.deletedAt).not.toBeNull();

    const acts = await db.query.activity.findMany();
    expect(
      acts.some(
        (a) =>
          a.action === "comment.deleted" &&
          a.pageId === "pg" &&
          (a.metadata as { commentId?: string })?.commentId === created.id,
      ),
    ).toBe(true);
  });

  it("denies a non-author without comment:moderate", async () => {
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "keep me" },
      { context: ctx() },
    );
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      call(commentRouter.delete, { id: created.id }, { context: ctx("u2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
