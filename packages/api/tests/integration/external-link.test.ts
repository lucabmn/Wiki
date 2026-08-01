import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, space, page } from "@nilovon-wiki/db/schema/index";

import { externalLinkRouter } from "../../src/routers/external-link";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
// u1 created the space, so they resolve to `admin` there. u2 is an ordinary org
// member with no space-member row — in a public space that is exactly `viewer`.
const ctx = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });
const viewerCtx = () => testContext(db, { userId: "u2", activeOrganizationId: "oA" });

const add = (input: { url: string; title: string; description?: string | null }) =>
  call(externalLinkRouter.create, { pageId: "pg1", ...input }, { context: ctx() });

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
    id: "s1",
    organizationId: "oA",
    slug: "s1",
    name: "S1",
    visibility: "public",
    createdBy: "u1",
  });
  await db.insert(page).values({ id: "pg1", spaceId: "s1", slug: "pg1", title: "Page 1" });
});
afterAll(async () => {
  await db.$end();
});
beforeEach(async () => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
  // Each test starts from an empty list; positions are per page, so leftovers
  // from a previous test would shift every ordering assertion.
  const links = await call(externalLinkRouter.list, { pageId: "pg1" }, { context: ctx() });
  for (const link of links) {
    await call(externalLinkRouter.delete, { id: link.id }, { context: ctx() });
  }
});

describe("externalLinks.create", () => {
  it("normalizes the URL before storing it", async () => {
    const [link] = await add({ url: "example.com/docs", title: "Docs" });
    expect(link?.url).toBe("https://example.com/docs");
  });

  it("rejects a non-http scheme at the API boundary, not just in the UI", async () => {
    await expect(add({ url: "javascript:alert(1)", title: "Nope" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("reports a duplicate URL as a conflict instead of a 500", async () => {
    await add({ url: "https://example.com/a", title: "A" });
    await expect(add({ url: "https://example.com/a", title: "Again" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("appends new links to the end of the list", async () => {
    await add({ url: "https://example.com/1", title: "One" });
    await add({ url: "https://example.com/2", title: "Two" });
    const links = await add({ url: "https://example.com/3", title: "Three" });
    expect(links.map((l) => l.title)).toEqual(["One", "Two", "Three"]);
  });
});

describe("externalLinks.move", () => {
  it("swaps a link with its neighbour", async () => {
    await add({ url: "https://example.com/1", title: "One" });
    const created = await add({ url: "https://example.com/2", title: "Two" });
    const second = created.find((l) => l.title === "Two")!;

    const moved = await call(
      externalLinkRouter.move,
      { id: second.id, direction: "up" },
      { context: ctx() },
    );
    expect(moved.map((l) => l.title)).toEqual(["Two", "One"]);
    // Positions stay dense, so a later insert still lands at the end.
    expect(moved.map((l) => l.position)).toEqual([0, 1]);
  });

  it("is a no-op at the edges rather than an error", async () => {
    const created = await add({ url: "https://example.com/1", title: "One" });
    const only = created[0]!;
    const links = await call(
      externalLinkRouter.move,
      { id: only.id, direction: "up" },
      { context: ctx() },
    );
    expect(links.map((l) => l.title)).toEqual(["One"]);
  });
});

describe("externalLinks.update", () => {
  it("clears the description when an empty one is sent", async () => {
    const created = await add({ url: "https://example.com/a", title: "A", description: "why" });
    const link = created[0]!;
    const updated = await call(
      externalLinkRouter.update,
      { id: link.id, description: "" },
      { context: ctx() },
    );
    expect(updated[0]?.description).toBeNull();
    // The untouched fields survive a partial patch.
    expect(updated[0]?.title).toBe("A");
  });

  it("treats a patch with no fields as a no-op", async () => {
    const created = await add({ url: "https://example.com/a", title: "A" });
    const links = await call(externalLinkRouter.update, { id: created[0]!.id }, { context: ctx() });
    expect(links[0]?.title).toBe("A");
  });
});

describe("authorization", () => {
  // In a public space a non-member resolves to `viewer`: the link list is part
  // of the page and readable, but changing it needs the same `write` capability
  // the page body does.
  it("lets a viewer read the list but not change it", async () => {
    const created = await add({ url: "https://example.com/a", title: "A" });
    const id = created[0]!.id;
    hasPermission.mockResolvedValue({ success: false });

    await expect(
      call(externalLinkRouter.list, { pageId: "pg1" }, { context: viewerCtx() }),
    ).resolves.toHaveLength(1);

    for (const attempt of [
      () =>
        call(
          externalLinkRouter.create,
          { pageId: "pg1", url: "https://example.com/b", title: "B" },
          { context: viewerCtx() },
        ),
      () => call(externalLinkRouter.update, { id, title: "Hijacked" }, { context: viewerCtx() }),
      () => call(externalLinkRouter.delete, { id }, { context: viewerCtx() }),
      () => call(externalLinkRouter.move, { id, direction: "down" }, { context: viewerCtx() }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
