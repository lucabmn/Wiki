import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, space, spaceMember } from "@nilovon-wiki/db/schema/index";

import { spaceRouter } from "../../src/routers/space";
import { pageRouter } from "../../src/routers/page";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId: string) => testContext(db, { userId, activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "ed", name: "Ed", email: "ed@x.io", createdAt: now, updatedAt: now },
    { id: "out", name: "Out", email: "out@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  // `ed` holds the org group "editors"; `out` does not.
  await db.insert(member).values([
    { id: "m-ed", organizationId: "oA", userId: "ed", role: "member,editors", createdAt: now },
    { id: "m-out", organizationId: "oA", userId: "out", role: "member", createdAt: now },
  ]);
  await db.insert(space).values({
    id: "sp",
    organizationId: "oA",
    slug: "s",
    name: "S",
    visibility: "private",
    createdBy: null,
  });
  // Grant the "editors" GROUP editor on the space — no direct user rows.
  await db.insert(spaceMember).values({
    id: "grant",
    spaceId: "sp",
    subject: "role",
    roleName: "editors",
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

describe("org group grants on a space", () => {
  it("a group member gains read + write via the grant (no direct row)", async () => {
    const got = await call(spaceRouter.get, { id: "sp" }, { context: ctx("ed") });
    expect(got.id).toBe("sp");
    const page = await call(
      pageRouter.create,
      { spaceId: "sp", title: "P" },
      { context: ctx("ed") },
    );
    expect(page.createdBy).toBe("ed");
  });

  it("a non-group member has no access to the private space", async () => {
    await expect(
      call(spaceRouter.get, { id: "sp" }, { context: ctx("out") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the space appears in the group member's list but not the outsider's", async () => {
    const edList = await call(spaceRouter.list, { includeArchived: false }, { context: ctx("ed") });
    expect(edList.map((s) => s.id)).toContain("sp");
    const outList = await call(
      spaceRouter.list,
      { includeArchived: false },
      { context: ctx("out") },
    );
    expect(outList.map((s) => s.id)).not.toContain("sp");
  });

  it("revoking the grant removes access for the whole group", async () => {
    await db.delete(spaceMember).where(eq(spaceMember.id, "grant"));
    await expect(call(spaceRouter.get, { id: "sp" }, { context: ctx("ed") })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });
});
