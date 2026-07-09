import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  organization,
  user,
  member,
  space,
  spaceMember,
  page,
  pageMember,
} from "@nilovon-wiki/db/schema/index";

import { pageRouter } from "../../src/routers/page";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId: string) => testContext(db, { userId, activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values(
    ["admin", "ed", "ed2"].map((u) => ({
      id: u,
      name: u,
      email: `${u}@x.io`,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values(
    ["admin", "ed", "ed2"].map((u) => ({
      id: `m-${u}`,
      organizationId: "oA",
      userId: u,
      createdAt: now,
    })),
  );
  await db.insert(space).values({
    id: "sp",
    organizationId: "oA",
    slug: "s",
    name: "S",
    visibility: "private",
    createdBy: "admin",
  });
  await db.insert(spaceMember).values([
    { id: "sm-admin", spaceId: "sp", subject: "user", userId: "admin", role: "admin" },
    { id: "sm-ed", spaceId: "sp", subject: "user", userId: "ed", role: "editor" },
    { id: "sm-ed2", spaceId: "sp", subject: "user", userId: "ed2", role: "editor" },
  ]);
  // An open page (inherits space) and a restricted page (own ACL: only `ed`).
  await db.insert(page).values([
    { id: "open", spaceId: "sp", slug: "open", title: "Open", textContent: "" },
    {
      id: "secret",
      spaceId: "sp",
      slug: "secret",
      title: "Secret",
      textContent: "",
      visibility: "private",
      createdBy: "ed",
    },
  ]);
  await db.insert(pageMember).values({
    id: "pm-ed",
    pageId: "secret",
    subject: "user",
    userId: "ed",
    role: "editor",
  });
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: false });
});

describe("per-page overrides restrict within a space", () => {
  it("a space editor NOT on the page ACL cannot read the restricted page", async () => {
    await expect(
      call(pageRouter.get, { id: "secret" }, { context: ctx("ed2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a page member can read it", async () => {
    const got = await call(pageRouter.get, { id: "secret" }, { context: ctx("ed") });
    expect(got.id).toBe("secret");
  });

  it("the space admin is never locked out by a page ACL", async () => {
    const got = await call(pageRouter.get, { id: "secret" }, { context: ctx("admin") });
    expect(got.id).toBe("secret");
  });

  it("page.list hides the restricted page from the excluded editor", async () => {
    const list = await call(
      pageRouter.list,
      { spaceId: "sp", parentId: null },
      { context: ctx("ed2") },
    );
    const ids = list.map((p) => p.id);
    expect(ids).toContain("open");
    expect(ids).not.toContain("secret");
  });

  it("page.list shows both pages to a page member", async () => {
    const list = await call(
      pageRouter.list,
      { spaceId: "sp", parentId: null },
      { context: ctx("ed") },
    );
    const ids = list.map((p) => p.id);
    expect(ids).toContain("open");
    expect(ids).toContain("secret");
  });

  it("the excluded editor cannot write the restricted page", async () => {
    await expect(
      call(pageRouter.update, { id: "secret", title: "Hacked" }, { context: ctx("ed2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
