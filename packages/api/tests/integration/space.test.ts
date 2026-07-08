import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  team,
  teamMember,
} from "@nilovon-wiki/db/schema/index";

import { spaceRouter } from "../../src/routers/space";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
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
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockClear();
  hasPermission.mockResolvedValue({ success: true });
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
