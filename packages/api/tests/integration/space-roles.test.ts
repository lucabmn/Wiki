import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Isolate per-space role enforcement: hasPermission is forced false so nobody is
// an org manager — access comes purely from spaceMember roles.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  organization,
  user,
  member,
  space,
  spaceMember,
  page,
} from "@nilovon-wiki/db/schema/index";

import { pageRouter } from "../../src/routers/page";
import { commentRouter } from "../../src/routers/comment";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId: string) => testContext(db, { userId, activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "admin", name: "Ad", email: "ad@x.io", createdAt: now, updatedAt: now },
    { id: "editor", name: "Ed", email: "ed@x.io", createdAt: now, updatedAt: now },
    { id: "commenter", name: "Co", email: "co@x.io", createdAt: now, updatedAt: now },
    { id: "viewer", name: "Vi", email: "vi@x.io", createdAt: now, updatedAt: now },
    { id: "outsider", name: "Ou", email: "ou@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values(
    ["admin", "editor", "commenter", "viewer", "outsider"].map((u) => ({
      id: `m-${u}`,
      organizationId: "oA",
      userId: u,
      createdAt: now,
    })),
  );
  // Private space so only explicit members have any access.
  await db.insert(space).values({
    id: "sp",
    organizationId: "oA",
    slug: "priv",
    name: "Priv",
    visibility: "private",
    createdBy: "admin",
  });
  await db.insert(spaceMember).values([
    // The creator is inserted as an admin member by space.create in production;
    // mirror that (a private space grants the creator no *implicit* access).
    { id: "sm-ad", spaceId: "sp", subject: "user", userId: "admin", role: "admin" },
    { id: "sm-ed", spaceId: "sp", subject: "user", userId: "editor", role: "editor" },
    { id: "sm-co", spaceId: "sp", subject: "user", userId: "commenter", role: "commenter" },
    { id: "sm-vw", spaceId: "sp", subject: "user", userId: "viewer", role: "viewer" },
  ]);
  // A page for comment tests.
  await db.insert(page).values({ id: "pg", spaceId: "sp", slug: "p", title: "P", textContent: "" });
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: false });
});

const createPage = (userId: string) =>
  call(pageRouter.create, { spaceId: "sp", title: "X" }, { context: ctx(userId) });
const comment = (userId: string) =>
  call(commentRouter.create, { pageId: "pg", body: "hi" }, { context: ctx(userId) });

describe("per-space write enforcement", () => {
  it("editor may create pages", async () => {
    const created = await createPage("editor");
    expect(created.createdBy).toBe("editor");
  });

  it("creator (space admin) may create pages", async () => {
    const created = await createPage("admin");
    expect(created.createdBy).toBe("admin");
  });

  it("commenter may not create pages but may comment", async () => {
    await expect(createPage("commenter")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const c = await comment("commenter");
    expect(c.authorId).toBe("commenter");
  });

  it("viewer may neither write nor comment", async () => {
    await expect(createPage("viewer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(comment("viewer")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("outsider (non-member of a private space) is denied outright", async () => {
    await expect(createPage("outsider")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(comment("outsider")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("org manager overrides space roles on a readable space", async () => {
    // A public space the outsider isn't a member of: manager override lets them
    // write; without it they'd only be a viewer.
    await db.insert(space).values({
      id: "sp-pub",
      organizationId: "oA",
      slug: "pub",
      name: "Pub",
      visibility: "public",
      createdBy: "admin",
    });
    hasPermission.mockResolvedValue({ success: true });
    const created = await call(
      pageRouter.create,
      { spaceId: "sp-pub", title: "Y" },
      { context: ctx("outsider") },
    );
    expect(created.createdBy).toBe("outsider");
  });
});
