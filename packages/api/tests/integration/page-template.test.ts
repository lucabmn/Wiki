import { call } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  attachment,
  comment,
  member,
  organization,
  page,
  pageLink,
  space,
  spaceMember,
  user,
} from "@nilovon-wiki/db/schema/index";

import { collectDigest } from "../../src/lib/notifications/collect";
import { dashboardRouter } from "../../src/routers/dashboard";
import { linkRouter } from "../../src/routers/link";
import { pageRouter } from "../../src/routers/page";
import { pageTemplateRouter } from "../../src/routers/page-template";
import { searchRouter } from "../../src/routers/search";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date("2026-05-04T09:00:00Z");
const windowStart = new Date("2026-05-04T08:00:00Z");
const inWindow = new Date("2026-05-04T08:30:00Z");

/** u1 owns both spaces; u2 may write in `sp` but has no access to `spSecret`. */
const asU1 = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });
const asU2 = () => testContext(db, { userId: "u2", activeOrganizationId: "oA" });

/**
 * The template body carries the two shapes a copy must not inherit: an image
 * node and a link mark, both pointing at attachments owned by the template.
 */
const TEMPLATE_CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agenda" }] },
    { type: "image", attrs: { src: "/attachments/att1/inline" } },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Protokoll",
          marks: [{ type: "link", attrs: { href: "/attachments/att1/download" } }],
        },
      ],
    },
  ],
};

function templatePage(id: string, spaceId: string, title: string) {
  return {
    id,
    spaceId,
    slug: id,
    title,
    content: TEMPLATE_CONTENT,
    textContent: "Agenda Protokoll",
    status: "published" as const,
    isTemplate: true,
    publishedAt: now,
    createdBy: "u1",
  };
}

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now },
    { id: "u2", name: "B", email: "b@x.io", createdAt: now, updatedAt: now },
    { id: "u3", name: "C", email: "c@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "OrgA", slug: "orga", createdAt: now },
    { id: "oB", name: "OrgB", slug: "orgb", createdAt: now },
  ]);
  await db.insert(member).values([
    { id: "mA", organizationId: "oA", userId: "u1", createdAt: now },
    { id: "mB", organizationId: "oA", userId: "u2", createdAt: now },
    { id: "mC", organizationId: "oB", userId: "u3", createdAt: now },
  ]);
  await db.insert(space).values([
    {
      id: "sp",
      organizationId: "oA",
      slug: "docs",
      name: "Docs",
      visibility: "public",
      createdBy: "u1",
    },
    // Restricted: readable by its creator (u1) and explicit members. u2 is
    // neither, so the template inside is unreadable to them — even though they
    // are an editor in `sp` and may create pages there.
    {
      id: "spSecret",
      organizationId: "oA",
      slug: "secret",
      name: "Secret",
      visibility: "restricted",
      createdBy: "u1",
    },
    {
      id: "spOther",
      organizationId: "oB",
      slug: "other",
      name: "Other",
      visibility: "public",
      createdBy: "u3",
    },
  ]);
  await db.insert(spaceMember).values({
    id: "smB",
    spaceId: "sp",
    subject: "user",
    userId: "u2",
    role: "editor",
  });
  await db.insert(page).values([
    templatePage("tpl", "sp", "Meeting-Notiz"),
    templatePage("tplSecret", "spSecret", "Geheime Vorlage"),
    { ...templatePage("tplOther", "spOther", "Fremde Vorlage"), createdBy: "u3" },
    {
      id: "pDoc",
      spaceId: "sp",
      slug: "doc",
      title: "Sprint-Rückblick",
      textContent: "Ein echtes Dokument.",
      status: "published",
      publishedAt: now,
      createdBy: "u1",
    },
  ]);
  // The template links to a real page — that must not become a backlink.
  await db.insert(pageLink).values({ id: "l1", sourcePageId: "tpl", targetPageId: "pDoc" });
  await db
    .insert(comment)
    .values({ id: "c1", pageId: "tpl", authorId: "u1", body: "Bitte kürzen." });
  await db.insert(attachment).values({
    id: "att1",
    spaceId: "sp",
    pageId: "tpl",
    fileName: "protokoll.pdf",
    mimeType: "application/pdf",
    size: 12,
    storageKey: "sp/att1.pdf",
    uploadedBy: "u1",
  });
  await db.insert(activity).values([
    {
      id: "actTpl",
      organizationId: "oA",
      action: "page.updated",
      spaceId: "sp",
      pageId: "tpl",
      actorId: "u1",
      createdAt: inWindow,
    },
    {
      id: "actDoc",
      organizationId: "oA",
      action: "page.updated",
      spaceId: "sp",
      pageId: "pDoc",
      actorId: "u1",
      createdAt: inWindow,
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

describe("templates stay out of the normal views", () => {
  it("pages.list hides them unless asked for explicitly", async () => {
    const listed = await call(pageRouter.list, { spaceId: "sp" }, { context: asU1() });
    expect(listed.map((row) => row.id)).toEqual(["pDoc"]);

    const withTemplates = await call(
      pageRouter.list,
      { spaceId: "sp", includeTemplates: true },
      { context: asU1() },
    );
    expect(withTemplates.map((row) => row.id).sort()).toEqual(["pDoc", "tpl"]);
  });

  it("search does not return them", async () => {
    expect(await call(searchRouter.pages, { query: "Agenda" }, { context: asU1() })).toEqual([]);
    // The same query path does find ordinary pages, so the empty result above
    // is the template filter and not a broken index.
    const hits = await call(searchRouter.pages, { query: "Dokument" }, { context: asU1() });
    expect(hits.map((hit) => hit.pageId)).toEqual(["pDoc"]);
  });

  it("backlinks do not count a template as an incoming reference", async () => {
    const backlinks = await call(linkRouter.backlinks, { id: "pDoc" }, { context: asU1() });
    expect(backlinks).toEqual([]);
  });

  it("the dashboard does not count them as pages", async () => {
    const overview = await call(dashboardRouter.overview, {}, { context: asU1() });
    // pDoc only — tpl is a template, tplSecret/tplOther are out of reach.
    expect(overview.pageCount).toBe(1);
    // The comment on the template is joined through page and drops out with it.
    expect(overview.openComments).toBe(0);
  });

  it("the digest reports no template activity", async () => {
    const content = await collectDigest(db as unknown as Database, {
      userId: "u2",
      organizationId: "oA",
      preferences: {
        frequency: "daily",
        hour: 8,
        weekday: 1,
        dayOfMonth: 1,
        timezone: "UTC",
        scope: "organization",
        categories: ["pages_updated"],
        skipIfEmpty: false,
        includeOwnActivity: true,
      },
      from: windowStart,
      to: now,
    });
    expect(content.entries.map((entry) => entry.pageId)).toEqual(["pDoc"]);
  });
});

describe("pages.listTemplates", () => {
  it("returns the space's templates with a preview", async () => {
    const templates = await call(
      pageTemplateRouter.listTemplates,
      { spaceId: "sp" },
      { context: asU1() },
    );
    expect(templates).toEqual([
      expect.objectContaining({
        id: "tpl",
        title: "Meeting-Notiz",
        excerpt: "Agenda Protokoll",
        hasContent: true,
      }),
    ]);
  });

  it("refuses a space the caller cannot read", async () => {
    await expect(
      call(pageTemplateRouter.listTemplates, { spaceId: "spSecret" }, { context: asU2() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("pages.createFromTemplate", () => {
  it("copies the body into a fresh draft without the template's baggage", async () => {
    const created = await call(
      pageTemplateRouter.createFromTemplate,
      { templateId: "tpl", spaceId: "sp", title: "Retro 12.05." },
      { context: asU1() },
    );

    expect(created).toMatchObject({
      title: "Retro 12.05.",
      slug: "retro-12-05",
      isTemplate: false,
      status: "draft",
      textContent: "Agenda Protokoll",
    });
    expect(created.id).not.toBe("tpl");

    const row = await db.query.page.findFirst({
      where: (fields, { eq }) => eq(fields.id, created.id),
    });
    // A copied CRDT snapshot would give two pages one document identity.
    expect(row?.yjsState).toBeNull();
    // Structure survives; both attachment references are gone — the image node
    // entirely, the link mark stripped off text that stays readable.
    expect(row?.content).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Agenda" }] },
        { type: "paragraph", content: [{ type: "text", text: "Protokoll", marks: [] }] },
      ],
    });

    const comments = await db.query.comment.findMany({
      where: (fields, { eq }) => eq(fields.pageId, created.id),
    });
    const attachments = await db.query.attachment.findMany({
      where: (fields, { eq }) => eq(fields.pageId, created.id),
    });
    expect(comments).toEqual([]);
    expect(attachments).toEqual([]);
  });

  it("falls back to the template title and de-duplicates the slug", async () => {
    const first = await call(
      pageTemplateRouter.createFromTemplate,
      { templateId: "tpl", spaceId: "sp" },
      { context: asU1() },
    );
    const second = await call(
      pageTemplateRouter.createFromTemplate,
      { templateId: "tpl", spaceId: "sp" },
      { context: asU1() },
    );
    expect(first.title).toBe("Meeting-Notiz");
    expect([first.slug, second.slug]).toEqual(["meeting-notiz", "meeting-notiz-2"]);
  });

  it("refuses a template the caller cannot read, despite write access at the target", async () => {
    await expect(
      call(
        pageTemplateRouter.createFromTemplate,
        { templateId: "tplSecret", spaceId: "sp" },
        { context: asU2() },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a template from another organization", async () => {
    await expect(
      call(
        pageTemplateRouter.createFromTemplate,
        { templateId: "tplOther", spaceId: "sp" },
        { context: asU1() },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a page that is not a template", async () => {
    await expect(
      call(
        pageTemplateRouter.createFromTemplate,
        { templateId: "pDoc", spaceId: "sp" },
        { context: asU1() },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
