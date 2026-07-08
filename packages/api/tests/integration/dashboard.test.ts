import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  organization,
  user,
  member,
  space,
  page,
  comment,
  activity,
} from "@nilovon-wiki/db/schema/index";

import { dashboardRouter } from "../../src/routers/dashboard";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

// u1 belongs to org A and can read the public space, but is NOT a member of the
// private space — so its pages/comments must be invisible to the counts.
const ctxA = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });
// u4 belongs to org B, which has no spaces at all → the zero path.
const ctxB = () => testContext(db, { userId: "u4", activeOrganizationId: "oB" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now },
    { id: "u2", name: "B", email: "b@x.io", createdAt: now, updatedAt: now },
    { id: "u4", name: "D", email: "d@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "OrgA", slug: "orga", createdAt: now },
    { id: "oB", name: "OrgB", slug: "orgb", createdAt: now },
  ]);
  await db.insert(member).values([
    { id: "mA", organizationId: "oA", userId: "u1", createdAt: now },
    { id: "mB", organizationId: "oB", userId: "u4", createdAt: now },
  ]);

  await db.insert(space).values([
    {
      id: "sPub",
      organizationId: "oA",
      slug: "pub",
      name: "Pub",
      visibility: "public",
      createdBy: "u1",
    },
    // private + u1 not a member → unreadable to u1
    {
      id: "sPriv",
      organizationId: "oA",
      slug: "priv",
      name: "Priv",
      visibility: "private",
      createdBy: "u2",
    },
  ]);

  await db.insert(page).values([
    // two readable pages: one created this week, one a month ago
    { id: "pNew", spaceId: "sPub", slug: "new", title: "New", createdAt: now, updatedAt: now },
    {
      id: "pOld",
      spaceId: "sPub",
      slug: "old",
      title: "Old",
      createdAt: monthAgo,
      updatedAt: monthAgo,
    },
    // archived readable page → excluded from pageCount
    {
      id: "pArch",
      spaceId: "sPub",
      slug: "arch",
      title: "Arch",
      archivedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    // page in the unreadable private space → excluded entirely
    {
      id: "pPriv",
      spaceId: "sPriv",
      slug: "priv",
      title: "Secret",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(comment).values([
    // readable space: one open, one resolved this week, one soft-deleted
    { id: "cOpen", pageId: "pNew", body: "open" },
    { id: "cResolved", pageId: "pNew", body: "done", resolvedAt: now, resolvedBy: "u1" },
    { id: "cDeleted", pageId: "pNew", body: "gone", deletedAt: now },
    // open comment in the unreadable space → excluded
    { id: "cPriv", pageId: "pPriv", body: "secret" },
  ]);

  // two distinct actors active this week; one stale actor a month ago
  await db.insert(activity).values([
    {
      id: "act1",
      organizationId: "oA",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pNew",
      actorId: "u1",
      createdAt: now,
    },
    {
      id: "act2",
      organizationId: "oA",
      action: "comment.created",
      spaceId: "sPub",
      pageId: "pNew",
      actorId: "u2",
      createdAt: now,
    },
    {
      id: "act3",
      organizationId: "oA",
      action: "page.updated",
      spaceId: "sPub",
      pageId: "pOld",
      actorId: "u1",
      createdAt: monthAgo,
    },
  ]);
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
});

describe("dashboard.overview", () => {
  it("counts only what the caller can read", async () => {
    const overview = await call(dashboardRouter.overview, {}, { context: ctxA() });
    expect(overview).toEqual({
      pageCount: 2, // pNew + pOld; pArch archived, pPriv unreadable
      pagesCreatedThisWeek: 1, // pNew only
      openComments: 1, // cOpen; cResolved/cDeleted/cPriv excluded
      commentsResolvedThisWeek: 1, // cResolved
      activeMembersThisWeek: 2, // u1 + u2; the month-old row doesn't add a new actor
    });
  });

  it("returns zeros when no space is readable", async () => {
    const overview = await call(dashboardRouter.overview, {}, { context: ctxB() });
    expect(overview).toEqual({
      pageCount: 0,
      pagesCreatedThisWeek: 0,
      openComments: 0,
      commentsResolvedThisWeek: 0,
      activeMembersThisWeek: 0,
    });
  });
});
