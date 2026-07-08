import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth module so permission checks are controllable and no db/env is
// pulled in transitively. Reads don't touch this; only mutations do.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { organization, user, member, space, attachment } from "@nilovon-wiki/db/schema/index";

import { attachmentRouter } from "../../src/routers/attachment";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
const now = new Date();
const ctx = (userId = "u1") => testContext(db, { userId, activeOrganizationId: "oA" });

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

const upload = () =>
  call(
    attachmentRouter.create,
    { spaceId: "sp", fileName: "spec.pdf", mimeType: "application/pdf", size: 1, storageKey: "k1" },
    { context: ctx() },
  );

describe("attachment.delete", () => {
  it("hard-deletes the uploader's own attachment and records attachment.deleted", async () => {
    const created = await upload();
    const res = await call(attachmentRouter.delete, { id: created.id }, { context: ctx() });
    expect(res.id).toBe(created.id);

    const gone = await db.query.attachment.findFirst({ where: eq(attachment.id, created.id) });
    expect(gone).toBeUndefined();

    // The row is hard-deleted, so the audit metadata carries id + file name.
    const acts = await db.query.activity.findMany();
    const deleted = acts.find((a) => a.action === "attachment.deleted");
    expect(deleted?.spaceId).toBe("sp");
    expect(deleted?.metadata).toMatchObject({ attachmentId: created.id, fileName: "spec.pdf" });
  });

  it("denies a non-uploader without attachment:delete", async () => {
    const created = await upload();
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      call(attachmentRouter.delete, { id: created.id }, { context: ctx("u2") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
