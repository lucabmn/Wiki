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
  attachment,
  tag,
  pageTag,
  activity,
} from "@nilovon-wiki/db/schema/index";

import { commentRouter } from "../../src/routers/comment";
import { attachmentRouter } from "../../src/routers/attachment";
import { linkRouter } from "../../src/routers/link";
import { searchRouter } from "../../src/routers/search";
import { activityRouter } from "../../src/routers/activity";
import { tagRouter } from "../../src/routers/tag";
import { userStateRouter } from "../../src/routers/user-state";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
// u1 is a member of org A but NOT a member of the private space.
const ctx = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  await db
    .insert(user)
    .values({ id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now });
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values({ id: "mA", organizationId: "oA", userId: "u1", createdAt: now });

  await db.insert(space).values([
    {
      id: "sPub",
      organizationId: "oA",
      slug: "pub",
      name: "Pub",
      visibility: "public",
      createdBy: "u1",
    },
    {
      id: "sPriv",
      organizationId: "oA",
      slug: "priv",
      name: "Priv",
      visibility: "private",
      createdBy: "u1",
    },
  ]);
  // Published: search indexes only published pages, and these fixtures exercise
  // space-access filtering, not the draft/published gate.
  await db.insert(page).values([
    {
      id: "pPub",
      spaceId: "sPub",
      slug: "pub",
      title: "Public Onboarding",
      textContent: "engineer onboarding",
      status: "published",
    },
    {
      id: "pPriv",
      spaceId: "sPriv",
      slug: "priv",
      title: "Secret Roadmap",
      textContent: "engineer roadmap",
      status: "published",
    },
  ]);
  // content in each space so the read paths have something to return / hide
  await db.insert(comment).values([
    { id: "cPub", pageId: "pPub", body: "hi" },
    { id: "cPriv", pageId: "pPriv", body: "secret" },
  ]);
  await db.insert(attachment).values([
    {
      id: "aPub",
      spaceId: "sPub",
      fileName: "a.png",
      mimeType: "image/png",
      size: 1,
      storageKey: "k1",
    },
    {
      id: "aPriv",
      spaceId: "sPriv",
      fileName: "b.png",
      mimeType: "image/png",
      size: 1,
      storageKey: "k2",
    },
  ]);
  await db.insert(tag).values({ id: "tPriv", spaceId: "sPriv", name: "roadmap" });
  await db.insert(pageTag).values({ pageId: "pPriv", tagId: "tPriv" });
  // activity rows: one org-level (no space), one in each space
  await db.insert(activity).values([
    { id: "actOrg", organizationId: "oA", action: "space.created", spaceId: null },
    { id: "actPub", organizationId: "oA", action: "page.created", spaceId: "sPub", pageId: "pPub" },
    {
      id: "actPriv",
      organizationId: "oA",
      action: "page.created",
      spaceId: "sPriv",
      pageId: "pPriv",
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

// Every space-scoped read must deny on the private space u1 can't see, and
// succeed on the public one. A missing assertSpaceRead on any path shows up here.
describe("read choke-point across all routers", () => {
  const denials: Array<[string, () => Promise<unknown>]> = [
    ["comment.list", () => call(commentRouter.list, { pageId: "pPriv" }, { context: ctx() })],
    [
      "attachment.list",
      () => call(attachmentRouter.list, { spaceId: "sPriv" }, { context: ctx() }),
    ],
    ["link.backlinks", () => call(linkRouter.backlinks, { id: "pPriv" }, { context: ctx() })],
    ["link.outgoing", () => call(linkRouter.outgoing, { id: "pPriv" }, { context: ctx() })],
    [
      "activity.list(space)",
      () => call(activityRouter.list, { spaceId: "sPriv" }, { context: ctx() }),
    ],
    [
      "search(space)",
      () => call(searchRouter.pages, { query: "roadmap", spaceId: "sPriv" }, { context: ctx() }),
    ],
    ["tag.listForPage", () => call(tagRouter.listForPage, { pageId: "pPriv" }, { context: ctx() })],
    [
      "me.addFavorite",
      () => call(userStateRouter.addFavorite, { pageId: "pPriv" }, { context: ctx() }),
    ],
    [
      "me.subscribe",
      () => call(userStateRouter.subscribe, { pageId: "pPriv" }, { context: ctx() }),
    ],
  ];

  for (const [name, fn] of denials) {
    it(`${name} denies access to a private space`, async () => {
      await expect(fn()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }

  it("comment.list returns comments on a readable page", async () => {
    const list = await call(commentRouter.list, { pageId: "pPub" }, { context: ctx() });
    expect(list.map((c) => c.id)).toEqual(["cPub"]);
  });

  it("attachment.list returns attachments in a readable space", async () => {
    const list = await call(attachmentRouter.list, { spaceId: "sPub" }, { context: ctx() });
    expect(list.map((a) => a.id)).toEqual(["aPub"]);
  });
});

describe("cross-space read filtering", () => {
  it("org-wide search never returns hits from unreadable spaces", async () => {
    // 'engineer' matches both pages; only the public one is readable.
    const hits = await call(searchRouter.pages, { query: "engineer" }, { context: ctx() });
    const ids = hits.map((h) => h.pageId);
    expect(ids).toContain("pPub");
    expect(ids).not.toContain("pPriv");
  });

  it("org-wide activity feed hides private-space events but keeps org-level ones", async () => {
    const feed = await call(activityRouter.list, {}, { context: ctx() });
    const ids = feed.map((a) => a.id);
    expect(ids).toContain("actOrg");
    expect(ids).toContain("actPub");
    expect(ids).not.toContain("actPriv");
  });
});
