import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  member,
  organization,
  page,
  pageMember,
  space,
  spaceMember,
  team,
  user,
} from "@nilovon-wiki/db/schema/index";

import { pageAccessRouter } from "../../src/routers/page-access";
import { spaceMemberRouter } from "../../src/routers/space-member";
import { testContext } from "./context";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
const now = new Date();
const ctx = () => testContext(db, { userId: "admin", activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values(
    ["admin", "same-org-user", "foreign-user"].map((id) => ({
      id,
      name: id,
      email: `${id}@x.io`,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(organization).values([
    { id: "oA", name: "Org A", slug: "org-a", createdAt: now },
    { id: "oB", name: "Org B", slug: "org-b", createdAt: now },
  ]);
  await db.insert(member).values([
    { id: "m-admin", organizationId: "oA", userId: "admin", createdAt: now },
    { id: "m-same", organizationId: "oA", userId: "same-org-user", createdAt: now },
    { id: "m-foreign", organizationId: "oB", userId: "foreign-user", createdAt: now },
  ]);
  await db.insert(team).values([
    { id: "same-org-team", name: "Same org", organizationId: "oA", createdAt: now },
    { id: "foreign-team", name: "Foreign", organizationId: "oB", createdAt: now },
  ]);
  await db.insert(space).values({
    id: "space-a",
    organizationId: "oA",
    slug: "space-a",
    name: "Space A",
    visibility: "private",
    createdBy: "admin",
  });
  await db.insert(spaceMember).values({
    id: "space-admin",
    spaceId: "space-a",
    subject: "user",
    userId: "admin",
    role: "admin",
  });
  await db.insert(page).values({
    id: "page-a",
    spaceId: "space-a",
    slug: "page-a",
    title: "Page A",
    textContent: "",
    createdBy: "admin",
  });
});

afterAll(async () => {
  await db.$end();
});

beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: false });
});

describe("space member organization boundary", () => {
  it("rejects a user who is not a member of the space's organization", async () => {
    await expect(
      call(
        spaceMemberRouter.add,
        { spaceId: "space-a", subject: "user", userId: "foreign-user", role: "viewer" },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const grant = await db.query.spaceMember.findFirst({
      where: and(eq(spaceMember.spaceId, "space-a"), eq(spaceMember.userId, "foreign-user")),
    });
    expect(grant).toBeUndefined();
  });

  it("rejects a team from another organization", async () => {
    await expect(
      call(
        spaceMemberRouter.add,
        { spaceId: "space-a", subject: "team", teamId: "foreign-team", role: "viewer" },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const grant = await db.query.spaceMember.findFirst({
      where: and(eq(spaceMember.spaceId, "space-a"), eq(spaceMember.teamId, "foreign-team")),
    });
    expect(grant).toBeUndefined();
  });

  it("accepts users and teams from the same organization", async () => {
    const userGrant = await call(
      spaceMemberRouter.add,
      { spaceId: "space-a", subject: "user", userId: "same-org-user", role: "viewer" },
      { context: ctx() },
    );
    const teamGrant = await call(
      spaceMemberRouter.add,
      { spaceId: "space-a", subject: "team", teamId: "same-org-team", role: "viewer" },
      { context: ctx() },
    );

    expect(userGrant.user?.id).toBe("same-org-user");
    expect(teamGrant.team?.id).toBe("same-org-team");
  });
});

describe("page member organization boundary", () => {
  it("rejects a user who is not a member of the page's organization", async () => {
    await expect(
      call(
        pageAccessRouter.addMember,
        { pageId: "page-a", subject: "user", userId: "foreign-user", role: "viewer" },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const grant = await db.query.pageMember.findFirst({
      where: and(eq(pageMember.pageId, "page-a"), eq(pageMember.userId, "foreign-user")),
    });
    expect(grant).toBeUndefined();
  });

  it("rejects a team from another organization", async () => {
    await expect(
      call(
        pageAccessRouter.addMember,
        { pageId: "page-a", subject: "team", teamId: "foreign-team", role: "viewer" },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const grant = await db.query.pageMember.findFirst({
      where: and(eq(pageMember.pageId, "page-a"), eq(pageMember.teamId, "foreign-team")),
    });
    expect(grant).toBeUndefined();
  });

  it("accepts users and teams from the same organization", async () => {
    const userGrant = await call(
      pageAccessRouter.addMember,
      { pageId: "page-a", subject: "user", userId: "same-org-user", role: "viewer" },
      { context: ctx() },
    );
    const teamGrant = await call(
      pageAccessRouter.addMember,
      { pageId: "page-a", subject: "team", teamId: "same-org-team", role: "viewer" },
      { context: ctx() },
    );

    expect(userGrant.user?.id).toBe("same-org-user");
    expect(teamGrant.team?.id).toBe("same-org-team");
  });
});
