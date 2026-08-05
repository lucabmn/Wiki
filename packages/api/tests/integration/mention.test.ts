import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively. Delivery never asks it — it resolves the org-manager
// override from the stored role — so these tests exercise the real access rules.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import {
  member,
  notification,
  organization,
  page,
  pageMember,
  space,
  user,
  userDirectNotificationSetting,
} from "@nilovon-wiki/db/schema/index";

import { commentRouter } from "../../src/routers/comment";
import { inboxRouter } from "../../src/routers/inbox";
import { pageRouter } from "../../src/routers/page";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId: string) => testContext(db, { userId, activeOrganizationId: "oA" });

/** A document naming `ids`, in one paragraph — the shape the editor saves. */
const doc = (...ids: string[]) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: ids.map((id) => ({ type: "mention", attrs: { id, label: id } })),
    },
  ],
});

let pageCounter = 0;
/** A fresh page per test, so one test's mention state can't reach another. */
async function newPage(overrides: { visibility?: "private" | null } = {}) {
  const id = `pg${++pageCounter}`;
  await db.insert(page).values({
    id,
    spaceId: "sp",
    slug: id,
    title: "Geheimprojekt",
    createdBy: "alice",
    visibility: overrides.visibility ?? null,
  });
  return id;
}

/** The inbox rows written for one recipient, newest last. */
async function inboxOf(userId: string) {
  return db.query.notification.findMany({ where: eq(notification.userId, userId) });
}

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@x.io", createdAt: now, updatedAt: now },
    { id: "bea", name: "Bea", email: "bea@x.io", createdAt: now, updatedAt: now },
    { id: "cara", name: "Cara", email: "cara@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values([
    // Alice created the space, which makes her a space admin; the others are
    // plain members, so per-page ACLs actually apply to them.
    { id: "m1", organizationId: "oA", userId: "alice", createdAt: now },
    { id: "m2", organizationId: "oA", userId: "bea", createdAt: now },
    { id: "m3", organizationId: "oA", userId: "cara", createdAt: now },
  ]);
  await db.insert(space).values({
    id: "sp",
    organizationId: "oA",
    slug: "docs",
    name: "Docs",
    visibility: "public",
    createdBy: "alice",
  });
});

afterAll(async () => {
  await db.$end();
});

beforeEach(async () => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
  await db.delete(notification);
  await db.delete(userDirectNotificationSetting);
});

describe("mentions on a page", () => {
  it("notifies a newly mentioned member exactly once", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });

    const rows = await inboxOf("bea");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "mention_page", pageId: id, actorId: "alice" });
  });

  it("stays silent when a save does not change the mentions", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });

    expect(await inboxOf("bea")).toHaveLength(1);
  });

  it("notifies again when a mention is removed and put back", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });
    await call(pageRouter.publish, { id, content: doc() }, { context: ctx("alice") });
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });

    expect(await inboxOf("bea")).toHaveLength(2);
  });

  it("collapses ten mentions of the same person into one notification", async () => {
    const id = await newPage();
    const ten = Array.from({ length: 10 }, () => "bea");
    await call(pageRouter.publish, { id, content: doc(...ten) }, { context: ctx("alice") });

    expect(await inboxOf("bea")).toHaveLength(1);
  });

  it("never notifies the author about their own mention", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("alice", "bea") }, { context: ctx("alice") });

    expect(await inboxOf("alice")).toHaveLength(0);
    expect(await inboxOf("bea")).toHaveLength(1);
  });

  it("tells nobody who may not read the page — not even its title", async () => {
    // A per-page override is narrower than the space: Cara can see the space,
    // but this page is shared with Bea only.
    const id = await newPage({ visibility: "private" });
    await db
      .insert(pageMember)
      .values({ pageId: id, subject: "user", userId: "bea", role: "viewer" });

    await call(pageRouter.publish, { id, content: doc("bea", "cara") }, { context: ctx("alice") });

    expect(await inboxOf("cara")).toHaveLength(0);
    expect(await inboxOf("bea")).toHaveLength(1);
    // And the title does not leak through the inbox either. Cara holds no
    // org-level permission — an org manager legitimately bypasses page ACLs.
    hasPermission.mockResolvedValue({ success: false });
    const inbox = await call(inboxRouter.list, {}, { context: ctx("cara") });
    expect(inbox).toHaveLength(0);
  });

  it("respects a recipient who switched mentions off", async () => {
    await db.insert(userDirectNotificationSetting).values({
      userId: "bea",
      organizationId: "oA",
      mentions: false,
    });
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });

    expect(await inboxOf("bea")).toHaveLength(0);
  });

  it("does not re-announce a suppressed mention once the setting comes back", async () => {
    await db.insert(userDirectNotificationSetting).values({
      userId: "bea",
      organizationId: "oA",
      mentions: false,
    });
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });
    await db
      .update(userDirectNotificationSetting)
      .set({ mentions: true })
      .where(eq(userDirectNotificationSetting.userId, "bea"));
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });

    expect(await inboxOf("bea")).toHaveLength(0);
  });
});

describe("mentions in comments", () => {
  it("notifies on a new comment and not on an edit that adds nobody", async () => {
    const pageId = await newPage();
    const created = await call(
      commentRouter.create,
      { pageId, body: "Kannst du das prüfen, @Bea?" },
      { context: ctx("alice") },
    );
    expect(await inboxOf("bea")).toHaveLength(1);

    await call(
      commentRouter.update,
      { id: created.id, body: "Kannst du das bitte prüfen, @Bea?" },
      { context: ctx("alice") },
    );
    const rows = await inboxOf("bea");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "mention_comment", commentId: created.id });
  });

  it("notifies whoever an edit names for the first time", async () => {
    const pageId = await newPage();
    const created = await call(
      commentRouter.create,
      { pageId, body: "Notiz an mich" },
      { context: ctx("alice") },
    );
    await call(
      commentRouter.update,
      { id: created.id, body: "Notiz an @Cara" },
      { context: ctx("alice") },
    );

    expect(await inboxOf("cara")).toHaveLength(1);
  });

  it("ignores an @ that names nobody", async () => {
    const pageId = await newPage();
    await call(
      commentRouter.create,
      { pageId, body: "schreib an alice@x.io oder @niemand" },
      { context: ctx("alice") },
    );

    expect(await db.query.notification.findMany()).toHaveLength(0);
  });
});

describe("replies", () => {
  it("notifies the author of the comment being answered", async () => {
    const pageId = await newPage();
    const parent = await call(
      commentRouter.create,
      { pageId, body: "Erste Frage" },
      { context: ctx("bea") },
    );
    await call(
      commentRouter.create,
      { pageId, parentId: parent.id, body: "Hier die Antwort" },
      { context: ctx("alice") },
    );

    const rows = await inboxOf("bea");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "comment_reply", actorId: "alice" });
  });

  it("does not notify someone who replies to themselves", async () => {
    const pageId = await newPage();
    const parent = await call(
      commentRouter.create,
      { pageId, body: "Erste Frage" },
      { context: ctx("bea") },
    );
    await call(
      commentRouter.create,
      { pageId, parentId: parent.id, body: "Nachtrag" },
      { context: ctx("bea") },
    );

    expect(await inboxOf("bea")).toHaveLength(0);
  });

  it("sends one notification when a reply also names the parent author", async () => {
    const pageId = await newPage();
    const parent = await call(
      commentRouter.create,
      { pageId, body: "Erste Frage" },
      { context: ctx("bea") },
    );
    await call(
      commentRouter.create,
      { pageId, parentId: parent.id, body: "@Bea ja, passt" },
      { context: ctx("alice") },
    );

    const rows = await inboxOf("bea");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("mention_comment");
  });

  it("respects a recipient who switched replies off", async () => {
    await db.insert(userDirectNotificationSetting).values({
      userId: "bea",
      organizationId: "oA",
      commentReplies: false,
    });
    const pageId = await newPage();
    const parent = await call(
      commentRouter.create,
      { pageId, body: "Erste Frage" },
      { context: ctx("bea") },
    );
    await call(
      commentRouter.create,
      { pageId, parentId: parent.id, body: "Antwort" },
      { context: ctx("alice") },
    );

    expect(await inboxOf("bea")).toHaveLength(0);
  });
});

describe("inbox", () => {
  it("lists a mention with its page and marks it read", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });

    const [item] = await call(inboxRouter.list, {}, { context: ctx("bea") });
    expect(item).toMatchObject({
      type: "mention_page",
      actor: { id: "alice", name: "Alice" },
      page: { id, title: "Geheimprojekt" },
      readAt: null,
    });

    expect(await call(inboxRouter.unreadCount, {}, { context: ctx("bea") })).toEqual({
      count: 1,
      capped: false,
    });
    await call(inboxRouter.markAllRead, {}, { context: ctx("bea") });
    expect(await call(inboxRouter.unreadCount, {}, { context: ctx("bea") })).toEqual({
      count: 0,
      capped: false,
    });
  });

  it("hides a notification once the page is restricted afterwards", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });
    expect(await call(inboxRouter.list, {}, { context: ctx("bea") })).toHaveLength(1);

    // Bea is a plain member, so the fresh page ACL locks her out — the row
    // stays in the table, but the inbox re-checks and stops serving it.
    await db.update(page).set({ visibility: "private" }).where(eq(page.id, id));
    hasPermission.mockResolvedValue({ success: false });
    expect(await call(inboxRouter.list, {}, { context: ctx("bea") })).toHaveLength(0);
  });

  it("refuses to mark someone else's notification read", async () => {
    const id = await newPage();
    await call(pageRouter.publish, { id, content: doc("bea") }, { context: ctx("alice") });
    const [item] = await call(inboxRouter.list, {}, { context: ctx("bea") });

    await call(inboxRouter.markRead, { id: item!.id }, { context: ctx("cara") });
    const row = await db.query.notification.findFirst({
      where: and(eq(notification.id, item!.id), eq(notification.userId, "bea")),
    });
    expect(row?.readAt).toBeNull();
  });
});
