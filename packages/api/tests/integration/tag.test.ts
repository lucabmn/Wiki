import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, space, page, tag } from "@nilovon-wiki/db/schema/index";

import { tagRouter } from "../../src/routers/tag";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db
    .insert(user)
    .values({ id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now });
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values({ id: "mA", organizationId: "oA", userId: "u1", createdAt: now });
  await db.insert(space).values([
    {
      id: "s1",
      organizationId: "oA",
      slug: "s1",
      name: "S1",
      visibility: "public",
      createdBy: "u1",
    },
    {
      id: "s2",
      organizationId: "oA",
      slug: "s2",
      name: "S2",
      visibility: "public",
      createdBy: "u1",
    },
  ]);
  await db.insert(page).values({ id: "pg1", spaceId: "s1", slug: "pg1", title: "Page 1" });
  // a tag that lives in a *different* space than the page
  await db.insert(tag).values([
    { id: "tagS1", spaceId: "s1", name: "same-space" },
    { id: "tagS2", spaceId: "s2", name: "other-space" },
  ]);
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
});

describe("tag.attach cross-space integrity", () => {
  it("rejects attaching a tag from another space", async () => {
    await expect(
      call(tagRouter.attach, { pageId: "pg1", tagId: "tagS2" }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("attaches a same-space tag and lists it on the page", async () => {
    const tags = await call(
      tagRouter.attach,
      { pageId: "pg1", tagId: "tagS1" },
      { context: ctx() },
    );
    expect(tags.map((t) => t.id)).toContain("tagS1");

    const listed = await call(tagRouter.listForPage, { pageId: "pg1" }, { context: ctx() });
    expect(listed.map((t) => t.id)).toEqual(["tagS1"]);
  });
});
