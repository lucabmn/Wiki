import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, space } from "@nilovon-wiki/db/schema/index";

import { pageRouter } from "../../src/routers/page";
import { linkRouter } from "../../src/routers/link";
import { searchRouter } from "../../src/routers/search";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now },
    // u2 is an org member but NOT a space member — only a viewer of the public
    // space, so they cannot write (per-space role enforcement).
    { id: "u2", name: "B", email: "b@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values([
    { id: "mA", organizationId: "oA", userId: "u1", createdAt: now },
    { id: "mB", organizationId: "oA", userId: "u2", createdAt: now },
  ]);
  // Public space: everyone reads; u1 is the creator (space admin) so u1 writes.
  await db.insert(space).values({
    id: "sp",
    organizationId: "oA",
    slug: "docs",
    name: "Docs",
    visibility: "public",
    createdBy: "u1",
  });
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
});

describe("page.create", () => {
  it("de-duplicates slugs within a space", async () => {
    const a = await call(pageRouter.create, { spaceId: "sp", title: "Notes" }, { context: ctx() });
    const b = await call(pageRouter.create, { spaceId: "sp", title: "Notes" }, { context: ctx() });
    expect(a.slug).toBe("notes");
    expect(b.slug).toBe("notes-2");
  });

  it("appends siblings in fractional order and emits activity", async () => {
    const first = await call(
      pageRouter.create,
      { spaceId: "sp", title: "First" },
      { context: ctx() },
    );
    const second = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Second" },
      { context: ctx() },
    );
    expect(first.position < second.position).toBe(true);

    const acts = await db.query.activity.findMany();
    expect(acts.some((x) => x.action === "page.created" && x.pageId === first.id)).toBe(true);
  });
});

describe("page.move cycle guard", () => {
  it("rejects moving a page underneath its own descendant", async () => {
    const parent = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Parent" },
      { context: ctx() },
    );
    const child = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Child", parentId: parent.id },
      { context: ctx() },
    );
    // move parent under child -> would create parent->child->parent
    await expect(
      call(pageRouter.move, { id: parent.id, parentId: child.id }, { context: ctx() }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("page.publish", () => {
  it("publishes, snapshots a revision, and records activity", async () => {
    const p = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Release", textContent: "notes" },
      { context: ctx() },
    );
    const published = await call(pageRouter.publish, { id: p.id }, { context: ctx() });
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();

    const revisions = await call(pageRouter.listRevisions, { id: p.id }, { context: ctx() });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.version).toBe(1);

    const acts = await db.query.activity.findMany();
    expect(acts.some((x) => x.action === "page.published" && x.pageId === p.id)).toBe(true);
  });

  it("promotes the working copy (title + content) into the published projection", async () => {
    const p = await call(pageRouter.create, { spaceId: "sp", title: "Draft" }, { context: ctx() });
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body v1" }] }],
    };
    const published = await call(
      pageRouter.publish,
      { id: p.id, title: "Published Title", content, textContent: "Body v1" },
      { context: ctx() },
    );
    // The read-facing projection now advances to the promoted working copy…
    expect(published.title).toBe("Published Title");
    expect(published.textContent).toBe("Body v1");
    expect(published.content).toEqual(content);
    // …and the same is snapshotted as the revision.
    const revisions = await call(pageRouter.listRevisions, { id: p.id }, { context: ctx() });
    expect(revisions[0]!.title).toBe("Published Title");
    expect(revisions[0]!.textContent).toBe("Body v1");
  });

  it("re-publish without content keeps the last published projection", async () => {
    const p = await call(pageRouter.create, { spaceId: "sp", title: "T" }, { context: ctx() });
    await call(
      pageRouter.publish,
      { id: p.id, content: { type: "doc", content: [] }, textContent: "first" },
      { context: ctx() },
    );
    const again = await call(pageRouter.publish, { id: p.id }, { context: ctx() });
    expect(again.textContent).toBe("first");
  });
});

// Option B: reader-facing surfaces (search, backlinks) expose published pages
// only — an unpublished draft is invisible even when its columns are populated.
describe("draft invisibility on reader surfaces", () => {
  it("full-text search excludes a draft and includes it after publish", async () => {
    const p = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Hidden", textContent: "zzsearchable" },
      { context: ctx() },
    );
    const beforeHits = await call(
      searchRouter.pages,
      { query: "zzsearchable" },
      { context: ctx() },
    );
    expect(beforeHits.map((h) => h.pageId)).not.toContain(p.id);

    await call(pageRouter.publish, { id: p.id, textContent: "zzsearchable" }, { context: ctx() });
    const afterHits = await call(searchRouter.pages, { query: "zzsearchable" }, { context: ctx() });
    expect(afterHits.map((h) => h.pageId)).toContain(p.id);
  });

  it("backlinks exclude a draft source and include it after publish", async () => {
    const target = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Target" },
      { context: ctx() },
    );
    const linkContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see",
              marks: [{ type: "link", attrs: { href: `/pages/${target.id}` } }],
            },
          ],
        },
      ],
    };
    // Created with link content: the pageLink row exists, but the source is a draft.
    const source = await call(
      pageRouter.create,
      { spaceId: "sp", title: "Source", content: linkContent },
      { context: ctx() },
    );
    const before = await call(linkRouter.backlinks, { id: target.id }, { context: ctx() });
    expect(before.map((b) => b.id)).not.toContain(source.id);

    await call(
      pageRouter.publish,
      { id: source.id, content: linkContent, textContent: "see" },
      { context: ctx() },
    );
    const after = await call(linkRouter.backlinks, { id: target.id }, { context: ctx() });
    expect(after.map((b) => b.id)).toContain(source.id);
  });
});

describe("page mutation authorization", () => {
  const ctxU2 = () => testContext(db, { userId: "u2", activeOrganizationId: "oA" });

  it("rejects create for a viewer (non-editor) of the space", async () => {
    // u2 is not an org manager and only a viewer of the public space.
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      call(pageRouter.create, { spaceId: "sp", title: "Nope" }, { context: ctxU2() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows create for an org manager even without a space membership", async () => {
    // hasPermission=true ⇒ isOrgManager ⇒ admin override on the readable space.
    hasPermission.mockResolvedValue({ success: true });
    const created = await call(
      pageRouter.create,
      { spaceId: "sp", title: "By Manager" },
      { context: ctxU2() },
    );
    expect(created.createdBy).toBe("u2");
  });
});
