import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively. Reads don't touch this; only mutations do.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  organization,
  user,
  member,
  space,
  spaceMember,
  page,
  comment,
} from "@nilovon-wiki/db/schema/index";

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

/**
 * The anchor is opaque to the server: it is stored and returned byte for byte,
 * and nothing in the API knows what a mark id is. These tests pin exactly that
 * — they must keep passing when the anchor format grows.
 */
const anchor = { v: 1, type: "mark", markId: "m-1", excerpt: "the runbook" };

describe("comment anchors", () => {
  it("stores an anchor unchanged and hands it back the same way", async () => {
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "inline", anchor },
      { context: ctx() },
    );
    expect(created.anchor).toEqual(anchor);

    const row = await db.query.comment.findFirst({ where: eq(comment.id, created.id) });
    expect(row?.anchor).toEqual(anchor);

    const listed = await call(commentRouter.list, { pageId: "pg" }, { context: ctx() });
    expect(listed.find((c) => c.id === created.id)?.anchor).toEqual(anchor);
  });

  it("keeps an anchor the server cannot interpret", async () => {
    const future = { v: 7, strategy: "something-we-have-not-invented", payload: [1, 2, 3] };
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "from the future", anchor: future },
      { context: ctx() },
    );
    expect(created.anchor).toEqual(future);
  });

  it("leaves page-wide comments as they were", async () => {
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "page-wide" },
      { context: ctx() },
    );
    expect(created.anchor).toBeNull();
  });

  it("threads a reply under an inline comment without an anchor of its own", async () => {
    const root = await call(
      commentRouter.create,
      { pageId: "pg", body: "inline root", anchor },
      { context: ctx() },
    );
    const reply = await call(
      commentRouter.create,
      { pageId: "pg", parentId: root.id, body: "reply" },
      { context: ctx() },
    );
    expect(reply.parentId).toBe(root.id);
    expect(reply.anchor).toBeNull();
  });

  it("resolves, reopens and deletes an inline comment like a page-wide one", async () => {
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "inline", anchor },
      { context: ctx() },
    );

    const resolved = await call(
      commentRouter.resolve,
      { id: created.id, resolved: true },
      { context: ctx() },
    );
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolvedBy).toBe("u1");
    // The anchor survives resolution — reopening must find the same text.
    expect(resolved.anchor).toEqual(anchor);

    const reopened = await call(
      commentRouter.resolve,
      { id: created.id, resolved: false },
      { context: ctx() },
    );
    expect(reopened.resolvedAt).toBeNull();

    await call(commentRouter.delete, { id: created.id }, { context: ctx() });
    const row = await db.query.comment.findFirst({ where: eq(comment.id, created.id) });
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("comment.create permissions", () => {
  // `hasPermission` false ⇒ not an org manager, so the space role decides.
  beforeEach(() => hasPermission.mockResolvedValue({ success: false }));
  afterEach(async () => {
    await db.delete(spaceMember).where(eq(spaceMember.id, "sm-u2"));
  });

  const grant = (role: "viewer" | "commenter") =>
    db
      .insert(spaceMember)
      .values({ id: "sm-u2", spaceId: "sp", subject: "user", userId: "u2", role });

  it("refuses a viewer, with and without an anchor", async () => {
    await grant("viewer");
    await expect(
      call(commentRouter.create, { pageId: "pg", body: "nope", anchor }, { context: ctx("u2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(commentRouter.create, { pageId: "pg", body: "nope" }, { context: ctx("u2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a commenter anchor a comment into the document", async () => {
    await grant("commenter");
    const created = await call(
      commentRouter.create,
      { pageId: "pg", body: "inline", anchor },
      { context: ctx("u2") },
    );
    expect(created.authorId).toBe("u2");
    expect(created.anchor).toEqual(anchor);
  });
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
