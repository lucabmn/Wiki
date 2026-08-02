import { call } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  activity,
  comment,
  member,
  organization,
  page,
  pageMember,
  space,
  spaceMember,
  user,
} from "@nilovon-wiki/db/schema/index";

import { userRouter } from "../../src/routers/user";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const older = new Date(now.getTime() - 60 * 60 * 1000);

// u1 (viewer) reads the public space but is no member of the private one, so
// everything u2 did in there must stay invisible on u2's profile.
const ctxViewer = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });
// u3 is an outsider in org B — u2 must not even resolve for them.
const ctxOutsider = () => testContext(db, { userId: "u3", activeOrganizationId: "oB" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "Viewer", email: "v@x.io", createdAt: older, updatedAt: older },
    { id: "u2", name: "Author", email: "a@x.io", createdAt: older, updatedAt: older },
    { id: "u3", name: "Outsider", email: "o@x.io", createdAt: older, updatedAt: older },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "OrgA", slug: "orga", createdAt: older },
    { id: "oB", name: "OrgB", slug: "orgb", createdAt: older },
  ]);
  await db.insert(member).values([
    { id: "mV", organizationId: "oA", userId: "u1", role: "member", createdAt: older },
    { id: "mA", organizationId: "oA", userId: "u2", role: "owner,admin", createdAt: now },
    { id: "mO", organizationId: "oB", userId: "u3", role: "member", createdAt: older },
  ]);

  await db.insert(space).values([
    {
      id: "sPub",
      organizationId: "oA",
      slug: "pub",
      name: "Pub",
      color: "#ff0000",
      visibility: "public",
      createdBy: "u2",
    },
    // private and u1 is not a member → unreadable to u1
    {
      id: "sPriv",
      organizationId: "oA",
      slug: "priv",
      name: "Priv",
      visibility: "private",
      createdBy: "u2",
    },
  ]);
  // u2 is an explicit member of the private space (so it is readable to *them*)
  await db
    .insert(spaceMember)
    .values([{ id: "smA", spaceId: "sPriv", subject: "user", userId: "u2", role: "admin" }]);

  await db.insert(page).values([
    {
      id: "pOpen",
      spaceId: "sPub",
      slug: "open",
      title: "Open",
      createdBy: "u2",
      lastEditedBy: "u2",
      createdAt: older,
      updatedAt: now,
      status: "published",
    },
    // archived → excluded from both counts and lists
    {
      id: "pArch",
      spaceId: "sPub",
      slug: "arch",
      title: "Arch",
      createdBy: "u2",
      lastEditedBy: "u2",
      archivedAt: now,
      createdAt: older,
      updatedAt: older,
    },
    // per-page override: u1 has no page grant → the row is dropped from lists
    {
      id: "pLocked",
      spaceId: "sPub",
      slug: "locked",
      title: "Locked",
      visibility: "private",
      createdBy: "u2",
      lastEditedBy: "u2",
      createdAt: older,
      updatedAt: older,
    },
    // in the private space → invisible to u1 entirely
    {
      id: "pSecret",
      spaceId: "sPriv",
      slug: "secret",
      title: "Secret",
      createdBy: "u2",
      lastEditedBy: "u2",
      createdAt: older,
      updatedAt: older,
    },
  ]);
  await db
    .insert(pageMember)
    .values([{ id: "pmA", pageId: "pLocked", subject: "user", userId: "u2", role: "admin" }]);

  await db.insert(comment).values([
    { id: "c1", pageId: "pOpen", authorId: "u2", body: "hi" },
    // soft-deleted → not counted
    { id: "c2", pageId: "pOpen", authorId: "u2", body: "gone", deletedAt: now },
    // in the unreadable space → not counted for u1
    { id: "c3", pageId: "pSecret", authorId: "u2", body: "secret" },
  ]);

  await db.insert(activity).values([
    {
      id: "act1",
      organizationId: "oA",
      action: "page.created",
      spaceId: "sPub",
      pageId: "pOpen",
      actorId: "u2",
      createdAt: older,
    },
    {
      id: "act2",
      organizationId: "oA",
      action: "page.updated",
      spaceId: "sPub",
      pageId: "pOpen",
      actorId: "u2",
      createdAt: now,
    },
  ]);
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  // The caller is a plain member: no org-manager override anywhere.
  hasPermission.mockResolvedValue({ success: false });
});

describe("users.list", () => {
  it("returns the active org's members with their split roles", async () => {
    const users = await call(userRouter.list, {}, { context: ctxViewer() });
    expect(users.map((u) => u.id)).toEqual(["u2", "u1"]); // ordered by name
    expect(users.find((u) => u.id === "u2")?.roles).toEqual(["owner", "admin"]);
    expect(users.find((u) => u.id === "u1")?.roles).toEqual(["member"]);
  });

  it("never leaks members of another organization", async () => {
    const users = await call(userRouter.list, {}, { context: ctxOutsider() });
    expect(users.map((u) => u.id)).toEqual(["u3"]);
  });
});

describe("users.get", () => {
  it("counts only contributions in spaces the caller can read", async () => {
    const profile = await call(userRouter.get, { userId: "u2" }, { context: ctxViewer() });
    expect(profile.name).toBe("Author");
    expect(profile.roles).toEqual(["owner", "admin"]);
    expect(profile.stats).toMatchObject({
      // pOpen + pLocked; pArch archived, pSecret unreadable. Page-level
      // overrides deliberately still count (see the note in the handler).
      pagesCreated: 2,
      pagesEdited: 2,
      comments: 1, // c1 only
      spacesContributed: 1, // sPub
    });
    // The newest of the two feed rows, not the oldest.
    expect(profile.stats.lastActiveAt?.getTime()).toBe(now.getTime());
  });

  it("rejects a lookup across organizations", async () => {
    await expect(
      call(userRouter.get, { userId: "u2" }, { context: ctxOutsider() }),
    ).rejects.toThrow(ORPCError);
  });
});

describe("users.pages", () => {
  it("drops pages hidden by a per-page override", async () => {
    const pages = await call(
      userRouter.pages,
      { userId: "u2", kind: "created", limit: 10 },
      { context: ctxViewer() },
    );
    expect(pages.map((p) => p.id)).toEqual(["pOpen"]);
    expect(pages[0]).toMatchObject({ spaceName: "Pub", spaceColor: "#ff0000", title: "Open" });
    // The trimmed projection must not carry the document body.
    expect(pages[0]).not.toHaveProperty("content");
  });

  it("shows every readable page to the author themselves", async () => {
    const authorCtx = testContext(db, { userId: "u2", activeOrganizationId: "oA" });
    const pages = await call(
      userRouter.pages,
      { userId: "u2", kind: "edited", limit: 10 },
      { context: authorCtx },
    );
    expect(pages.map((p) => p.id).sort()).toEqual(["pLocked", "pOpen", "pSecret"]);
  });
});
