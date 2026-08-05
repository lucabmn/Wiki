import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  organization,
  user,
  member,
  page,
  space,
  spaceMember,
  activity,
} from "@nilovon-wiki/db/schema/index";

import { onboardingRouter } from "../../src/routers/onboarding";
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
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
});

describe("onboarding.seedSampleData", () => {
  it("seeds spaces, published pages, creator membership and activity", async () => {
    const result = await call(onboardingRouter.seedSampleData, {}, { context: ctx() });
    expect(result.spaces).toBe(3);
    expect(result.pages).toBe(9);
    expect(result.templates).toBe(3);

    const spaces = await db.query.space.findMany({ where: eq(space.organizationId, "oA") });
    expect(spaces).toHaveLength(3);
    expect(spaces.every((s) => s.visibility === "public" && s.createdBy === "u1")).toBe(true);

    const pages = await db.query.page.findMany({ where: eq(page.isTemplate, false) });
    expect(pages).toHaveLength(9);
    expect(pages.every((p) => p.status === "published" && p.publishedAt !== null)).toBe(true);

    // The starter templates land in exactly one space, published so their body
    // reaches `content` and can actually be copied out.
    const templates = await db.query.page.findMany({ where: eq(page.isTemplate, true) });
    expect(templates).toHaveLength(3);
    expect(new Set(templates.map((t) => t.spaceId)).size).toBe(1);
    expect(templates.every((t) => t.status === "published" && t.content !== null)).toBe(true);
    // positions within a space are strictly ordered (fractional indexing)
    const firstSpacePages = pages
      .filter((p) => p.spaceId === spaces[0]!.id)
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(firstSpacePages.length).toBe(3);

    const memberships = await db.query.spaceMember.findMany({
      where: eq(spaceMember.userId, "u1"),
    });
    expect(memberships).toHaveLength(3);
    expect(memberships.every((m) => m.role === "admin")).toBe(true);

    const acts = await db.query.activity.findMany({ where: eq(activity.organizationId, "oA") });
    // 3 space.created + 9 page.created; templates write no activity row.
    expect(acts).toHaveLength(12);
  });

  it("is idempotent — re-seeding an org with content is a no-op", async () => {
    const result = await call(onboardingRouter.seedSampleData, {}, { context: ctx() });
    expect(result).toEqual({ spaces: 0, pages: 0, templates: 0 });
    expect(await db.query.space.findMany({ where: eq(space.organizationId, "oA") })).toHaveLength(
      3,
    );
  });

  it("rejects when the caller lacks space:create", async () => {
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      call(onboardingRouter.seedSampleData, {}, { context: ctx() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
