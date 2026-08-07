import { call } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Access-control changes have to be auditable.
 *
 * "Who could see this, and since when" is the question an audit log exists to
 * answer, and until these events were recorded a grant could be added and
 * removed again between two reads of the members list leaving nothing behind.
 * The rows also have to *name* the grantee: the membership row itself is gone by
 * the time anybody reads the log.
 */

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  activity,
  member,
  organization,
  page,
  space,
  spaceMember,
  user,
} from "@nilovon-wiki/db/schema/index";

import { pageAccessRouter } from "../../src/routers/page-access";
import { spaceMemberRouter } from "../../src/routers/space-member";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId: string) => testContext(db, { userId, activeOrganizationId: "oA" });

/** The most recent audit row, whatever it was. */
async function latestActivity() {
  const rows = await db
    .select()
    .from(activity)
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(1);
  return rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values(
    ["admin", "guest", "second"].map((u) => ({
      id: u,
      name: `Name ${u}`,
      email: `${u}@x.io`,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values(
    ["admin", "guest", "second"].map((u) => ({
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
    name: "Space One",
    visibility: "private",
    createdBy: "admin",
  });
  await db.insert(spaceMember).values([
    { id: "sm-admin", spaceId: "sp", subject: "user", userId: "admin", role: "admin" },
    // A second admin, so removing the first is not blocked by the
    // last-admin rule the removal path also enforces.
    { id: "sm-second", spaceId: "sp", subject: "user", userId: "second", role: "admin" },
  ]);
  await db
    .insert(page)
    .values({ id: "pg", spaceId: "sp", slug: "p", title: "Page One", textContent: "" });
});

afterAll(async () => {
  await db.$end();
});

beforeEach(async () => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: false });
  await db.delete(activity);
});

describe("space membership is audited", () => {
  it("records who was granted access, with a name that outlives the grant", async () => {
    const created = await call(
      spaceMemberRouter.add,
      { spaceId: "sp", subject: "user", userId: "guest", role: "viewer" },
      { context: ctx("admin") },
    );

    const row = await latestActivity();
    expect(row?.action).toBe("space.member_added");
    expect(row?.actorId).toBe("admin");
    expect(row?.spaceId).toBe("sp");
    expect(row?.metadata).toMatchObject({
      role: "viewer",
      subject: "user",
      subjectId: "guest",
      subjectName: "Name guest",
      subjectEmail: "guest@x.io",
    });

    // And the removal, which is the half that leaves no other trace at all.
    await db.delete(activity);
    await call(spaceMemberRouter.remove, { id: created.id }, { context: ctx("admin") });
    const removal = await latestActivity();
    expect(removal?.action).toBe("space.member_removed");
    expect(removal?.metadata).toMatchObject({ subjectId: "guest", role: "viewer" });
  });

  it("records both sides of a role change", async () => {
    const created = await call(
      spaceMemberRouter.add,
      { spaceId: "sp", subject: "user", userId: "guest", role: "viewer" },
      { context: ctx("admin") },
    );
    await db.delete(activity);

    await call(
      spaceMemberRouter.updateRole,
      { id: created.id, role: "editor" },
      { context: ctx("admin") },
    );

    const row = await latestActivity();
    expect(row?.action).toBe("space.member_role_changed");
    // "editor" alone does not say whether access was widened or narrowed.
    expect(row?.metadata).toMatchObject({ from: "viewer", to: "editor", subjectId: "guest" });

    await call(spaceMemberRouter.remove, { id: created.id }, { context: ctx("admin") });
  });

  it("writes no row for a change that was rolled back", async () => {
    // Removing the last admin is refused. An audit log that recorded the
    // attempt as a fact would be worse than one that missed it.
    const admins = await db
      .select({ id: spaceMember.id })
      .from(spaceMember)
      .where(eq(spaceMember.spaceId, "sp"));
    expect(admins.length).toBe(2);
    await call(spaceMemberRouter.remove, { id: "sm-second" }, { context: ctx("admin") });
    await db.delete(activity);

    await expect(
      call(spaceMemberRouter.remove, { id: "sm-admin" }, { context: ctx("admin") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await latestActivity()).toBeUndefined();

    // Put the second admin back for the tests that follow.
    await db
      .insert(spaceMember)
      .values({ id: "sm-second", spaceId: "sp", subject: "user", userId: "second", role: "admin" });
  });
});

describe("page access is audited", () => {
  it("records a visibility override with both sides", async () => {
    await call(
      pageAccessRouter.setVisibility,
      { pageId: "pg", visibility: "private" },
      { context: ctx("admin") },
    );

    const row = await latestActivity();
    expect(row?.action).toBe("page.access_changed");
    expect(row?.pageId).toBe("pg");
    expect(row?.metadata).toMatchObject({ title: "Page One", from: null, to: "private" });
  });

  it("records page-level grants, changes and revocations", async () => {
    const created = await call(
      pageAccessRouter.addMember,
      { pageId: "pg", subject: "user", userId: "guest", role: "viewer" },
      { context: ctx("admin") },
    );
    expect((await latestActivity())?.action).toBe("page.member_added");

    await call(
      pageAccessRouter.updateRole,
      { id: created.id, role: "editor" },
      { context: ctx("admin") },
    );
    const changed = await latestActivity();
    expect(changed?.action).toBe("page.member_role_changed");
    expect(changed?.metadata).toMatchObject({ from: "viewer", to: "editor" });

    await call(pageAccessRouter.removeMember, { id: created.id }, { context: ctx("admin") });
    const removed = await latestActivity();
    expect(removed?.action).toBe("page.member_removed");
    expect(removed?.metadata).toMatchObject({ subjectId: "guest", subjectName: "Name guest" });
  });
});
