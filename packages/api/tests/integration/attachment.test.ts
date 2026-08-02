import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively. Reads don't touch this; only mutations do.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, page, space, attachment } from "@nilovon-wiki/db/schema/index";

import { createAttachment } from "../../src/lib/attachments";
import { setStorage } from "../../src/lib/storage";
import { attachmentRouter } from "../../src/routers/attachment";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
let storage: Files;
const now = new Date();
const ctx = (userId = "u1") => testContext(db, { userId, activeOrganizationId: "oA" });
// `createAttachment` takes the post-guard context; the test harness types its
// session as nullable because it fakes the better-auth module.
const authed = (userId = "u1") => ctx(userId) as unknown as Parameters<typeof createAttachment>[0];

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "u1", name: "A", email: "a@x.io", createdAt: now, updatedAt: now },
    { id: "u2", name: "B", email: "b@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "OrgA", slug: "orga", createdAt: now });
  await db.insert(member).values([
    { id: "mA", organizationId: "oA", userId: "u1", createdAt: now },
    { id: "mB", organizationId: "oA", userId: "u2", createdAt: now },
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
    {
      id: "secret",
      organizationId: "oA",
      slug: "secret",
      name: "Secret",
      visibility: "private",
      createdBy: "u1",
    },
  ]);
  await db.insert(page).values([
    {
      id: "pg",
      spaceId: "sp",
      slug: "runbook",
      title: "Runbook",
      status: "published",
      publishedAt: now,
      position: "a0",
      createdBy: "u1",
    },
    {
      id: "draft-pg",
      spaceId: "sp",
      slug: "draft",
      title: "Draft",
      status: "draft",
      position: "a1",
      createdBy: "u1",
    },
  ]);
});
afterAll(async () => {
  setStorage(null);
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
  // The in-memory adapter exercises the real Files surface without a bucket;
  // it verifies the store/register/serve wiring, not the S3 dialect itself.
  storage = new Files({ adapter: memory() });
  setStorage(storage);
});

const fileOf = (name = "spec.pdf", body = "hello") => ({
  name,
  type: "application/pdf",
  size: body.length,
  body: new Blob([body], { type: "application/pdf" }),
});

const upload = (overrides: { pageId?: string | null; name?: string; draft?: boolean } = {}) =>
  createAttachment(authed(), {
    spaceId: "sp",
    pageId: overrides.pageId ?? null,
    draft: overrides.draft,
    file: fileOf(overrides.name),
  });

describe("createAttachment", () => {
  it("stores the bytes and registers a row pointing at them", async () => {
    const created = await upload();

    expect(created.fileName).toBe("spec.pdf");
    expect(created.size).toBe(5);
    const stored = await storage.download(created.storageKey);
    expect(await stored.text()).toBe("hello");
  });

  it("derives the storage key server-side, scoped to the space", async () => {
    const created = await upload();
    // A client-supplied key would let a caller register a row pointing at
    // another space's object and read it back through the download proxy.
    expect(created.storageKey.startsWith("spaces/sp/")).toBe(true);
    expect(created.storageKey).not.toContain("spec.pdf");
    expect(created.storageKey.endsWith(".pdf")).toBe(true);
  });

  it("gives two uploads of the same file name distinct keys", async () => {
    const a = await upload();
    const b = await upload();
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(await (await storage.download(a.storageKey)).text()).toBe("hello");
  });

  it("refuses a hostile file name instead of letting it shape the key", async () => {
    const created = await createAttachment(authed(), {
      spaceId: "sp",
      pageId: null,
      file: fileOf("../../etc/passwd"),
    });
    expect(created.storageKey.startsWith("spaces/sp/")).toBe(true);
    expect(created.storageKey).not.toContain("..");
  });

  it("records an attachment.uploaded activity row", async () => {
    const created = await upload();
    const acts = await db.query.activity.findMany();
    const uploaded = acts.find(
      (a) =>
        a.action === "attachment.uploaded" &&
        (a.metadata as { attachmentId?: string } | null)?.attachmentId === created.id,
    );
    expect(uploaded?.spaceId).toBe("sp");
  });

  it("denies a caller without write access and stores nothing", async () => {
    // `secret` is private and u2 holds no grant on it, so authorization must
    // fail — and it must fail *before* any bytes reach the store.
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      createAttachment(authed("u2"), { spaceId: "secret", pageId: null, file: fileOf() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await storage.list()).items).toHaveLength(0);
  });

  it("forces uploads on never-published pages behind the publication boundary", async () => {
    const created = await upload({ pageId: "draft-pg" });
    expect(created.isDraft).toBe(true);
    expect(created.publishOnNextPublish).toBe(true);
  });

  it("reports a clear error when no object storage is configured", async () => {
    setStorage(null);
    await expect(
      createAttachment(authed(), { spaceId: "sp", pageId: null, file: fileOf() }),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});

describe("attachment.get", () => {
  it("returns metadata for a reader of the owning page", async () => {
    const created = await upload({ pageId: "pg" });
    const got = await call(attachmentRouter.get, { id: created.id }, { context: ctx("u2") });
    expect(got.storageKey).toBe(created.storageKey);
  });

  it("keeps staged editor assets writer-only until publication", async () => {
    const created = await upload({ pageId: "pg", draft: true });
    hasPermission.mockResolvedValue({ success: false });

    await expect(
      call(attachmentRouter.get, { id: created.id }, { context: ctx("u2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const readerList = await call(attachmentRouter.list, { pageId: "pg" }, { context: ctx("u2") });
    expect(readerList.map((item) => item.id)).not.toContain(created.id);

    hasPermission.mockResolvedValue({ success: true });
    const writerList = await call(attachmentRouter.list, { pageId: "pg" }, { context: ctx() });
    expect(writerList.map((item) => item.id)).toContain(created.id);
  });
});

describe("attachment.delete", () => {
  it("hard-deletes the uploader's own attachment and drops the object", async () => {
    const created = await upload();
    const res = await call(attachmentRouter.delete, { id: created.id }, { context: ctx() });
    expect(res.id).toBe(created.id);

    const gone = await db.query.attachment.findFirst({ where: eq(attachment.id, created.id) });
    expect(gone).toBeUndefined();
    expect(await storage.exists(created.storageKey)).toBe(false);

    // The row is hard-deleted, so the audit metadata carries id + file name.
    const acts = await db.query.activity.findMany();
    const deleted = acts.find(
      (a) =>
        a.action === "attachment.deleted" &&
        (a.metadata as { attachmentId?: string } | null)?.attachmentId === created.id,
    );
    expect(deleted?.spaceId).toBe("sp");
    expect(deleted?.metadata).toMatchObject({ fileName: "spec.pdf" });
  });

  it("denies a non-uploader without attachment:delete", async () => {
    const created = await upload();
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      call(attachmentRouter.delete, { id: created.id }, { context: ctx("u2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
