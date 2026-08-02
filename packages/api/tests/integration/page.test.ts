import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { attachment, organization, user, member, page, space } from "@nilovon-wiki/db/schema/index";

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

describe("page.import", () => {
  const paragraph = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("creates a hierarchy atomically and de-duplicates slugs", async () => {
    const result = await call(
      pageRouter.import,
      {
        spaceId: "sp",
        pages: [
          {
            key: "guide/index.html",
            title: "Migration Guide",
            sourcePath: "guide/index.html",
            content: paragraph("Guide"),
            textContent: "Guide",
          },
          {
            key: "guide/install.html",
            parentKey: "guide/index.html",
            title: "Migration Guide",
            sourcePath: "guide/install.html",
            content: paragraph("Install"),
            textContent: "Install",
          },
        ],
      },
      { context: ctx() },
    );

    expect(result.imported.map((item) => item.slug)).toEqual([
      "migration-guide",
      "migration-guide-2",
    ]);
    const parent = await db.query.page.findFirst({
      where: (row, { eq }) => eq(row.id, result.imported[0]!.id),
    });
    const child = await db.query.page.findFirst({
      where: (row, { eq }) => eq(row.id, result.imported[1]!.id),
    });
    expect(parent?.status).toBe("draft");
    expect(parent?.content).toEqual(paragraph("Guide"));
    expect(child?.parentId).toBe(parent?.id);

    const readerPage = await call(
      pageRouter.get,
      { id: result.imported[0]!.id },
      { context: ctx() },
    );
    const readerList = await call(pageRouter.list, { spaceId: "sp" }, { context: ctx() });
    expect(readerPage.content).toBeNull();
    expect(readerPage.textContent).toBe("");
    expect(readerList.find((item) => item.id === readerPage.id)?.content).toBeNull();
  });

  it("finalizes uploaded image and attachment placeholders", async () => {
    const imagePlaceholder = "migration-asset:local%3Aimages%2Fdiagram.png";
    const linkPlaceholder = "migration-asset:local%3Afiles%2Fguide.pdf";
    const result = await call(
      pageRouter.import,
      {
        spaceId: "sp",
        pages: [
          {
            key: "assets.html",
            title: "Imported Assets",
            sourcePath: "assets.html",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "image", attrs: { src: imagePlaceholder, alt: "Diagram" } },
                    {
                      type: "text",
                      text: "Guide",
                      marks: [{ type: "link", attrs: { href: linkPlaceholder } }],
                    },
                  ],
                },
              ],
            },
            textContent: "Guide",
          },
        ],
      },
      { context: ctx() },
    );
    const pageId = result.imported[0]!.id;
    await db.insert(attachment).values([
      {
        id: "asset-image",
        spaceId: "sp",
        pageId,
        fileName: "diagram.png",
        mimeType: "image/png",
        size: 12,
        storageKey: "test/image",
        uploadedBy: "u1",
      },
      {
        id: "asset-pdf",
        spaceId: "sp",
        pageId,
        fileName: "guide.pdf",
        mimeType: "application/pdf",
        size: 12,
        storageKey: "test/pdf",
        uploadedBy: "u1",
      },
    ]);

    await call(
      pageRouter.finalizeImportAssets,
      {
        pages: [
          {
            id: pageId,
            assets: [
              { placeholder: imagePlaceholder, attachmentId: "asset-image" },
              { placeholder: linkPlaceholder, attachmentId: "asset-pdf" },
            ],
          },
        ],
      },
      { context: ctx() },
    );
    const imported = await db.query.page.findFirst({
      where: (row, { eq }) => eq(row.id, pageId),
    });
    const json = JSON.stringify(imported?.content);
    expect(json).toContain("/attachments/asset-image/inline");
    expect(json).toContain("/attachments/asset-pdf/download");
    expect(json).not.toContain("migration-asset:");
  });

  it("publishes with an initial revision", async () => {
    const result = await call(
      pageRouter.import,
      {
        spaceId: "sp",
        status: "published",
        pages: [
          {
            key: "published.html",
            title: "Imported Published Page",
            sourcePath: "published.html",
            content: paragraph("Published body"),
            textContent: "Published body",
          },
        ],
      },
      { context: ctx() },
    );
    const imported = result.imported[0]!;
    const revisions = await call(pageRouter.listRevisions, { id: imported.id }, { context: ctx() });
    expect(imported.status).toBe("published");
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.summary).toContain("published.html");
  });

  it("rejects style-bearing attributes without creating partial rows", async () => {
    const before = await db.$count(page);
    await expect(
      call(
        pageRouter.import,
        {
          spaceId: "sp",
          pages: [
            {
              key: "styled.html",
              title: "Styled",
              sourcePath: "styled.html",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    attrs: { textAlign: "left;background-image:url(https://attacker.invalid)" },
                    content: [{ type: "text", text: "Bad" }],
                  },
                ],
              },
              textContent: "Bad",
            },
          ],
        },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.$count(page)).toBe(before);
  });

  it("rejects unsafe documents without creating partial rows", async () => {
    const before = await db.$count(page);
    await expect(
      call(
        pageRouter.import,
        {
          spaceId: "sp",
          pages: [
            {
              key: "safe.html",
              title: "Safe before failure",
              sourcePath: "safe.html",
              content: paragraph("Safe"),
              textContent: "Safe",
            },
            {
              key: "unsafe.html",
              title: "Unsafe",
              sourcePath: "unsafe.html",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Bad",
                        marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                      },
                    ],
                  },
                ],
              },
              textContent: "Bad",
            },
          ],
        },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.$count(page)).toBe(before);
  });
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

  it("promotes staged page attachments at the publication boundary", async () => {
    const p = await call(
      pageRouter.create,
      { spaceId: "sp", title: "With image" },
      { context: ctx() },
    );
    await db.insert(attachment).values([
      {
        id: "draft-asset",
        spaceId: "sp",
        pageId: p.id,
        fileName: "draft.png",
        mimeType: "image/png",
        size: 10,
        storageKey: "draft/key",
        uploadedBy: "u1",
        isDraft: true,
      },
      {
        id: "removed-draft-asset",
        spaceId: "sp",
        pageId: p.id,
        fileName: "removed.png",
        mimeType: "image/png",
        size: 10,
        storageKey: "draft/removed",
        uploadedBy: "u1",
        isDraft: true,
      },
      {
        id: "queued-sidebar-asset",
        spaceId: "sp",
        pageId: p.id,
        fileName: "sidebar.pdf",
        mimeType: "application/pdf",
        size: 10,
        storageKey: "draft/sidebar",
        uploadedBy: "u1",
        isDraft: true,
        publishOnNextPublish: true,
      },
    ]);
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "https://api.example.com/attachments/draft-asset/inline" },
            },
          ],
        },
      ],
    };

    await call(pageRouter.publish, { id: p.id, content }, { context: ctx() });
    const rows = await db.query.attachment.findMany({
      where: (row, { eq }) => eq(row.pageId, p.id),
    });
    expect(rows.find((item) => item.id === "draft-asset")?.isDraft).toBe(false);
    expect(rows.find((item) => item.id === "queued-sidebar-asset")?.isDraft).toBe(false);
    expect(rows.find((item) => item.id === "removed-draft-asset")?.isDraft).toBe(true);
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
  it("keeps an archived, never-published draft body private", async () => {
    const p = await call(
      pageRouter.create,
      {
        spaceId: "sp",
        title: "Private draft",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "secret" }] }],
        },
        textContent: "secret",
      },
      { context: ctx() },
    );
    await call(pageRouter.archive, { id: p.id }, { context: ctx() });

    const archived = await call(pageRouter.get, { id: p.id }, { context: ctx() });
    expect(archived.status).toBe("archived");
    expect(archived.publishedAt).toBeNull();
    expect(archived.content).toBeNull();
    expect(archived.textContent).toBe("");
  });

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
