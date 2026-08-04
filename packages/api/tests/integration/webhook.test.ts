import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import type { Database } from "@nilovon-wiki/db";
import {
  member,
  organization,
  space,
  user,
  webhook,
  webhookDelivery,
} from "@nilovon-wiki/db/schema/index";

import { recordActivity } from "../../src/lib/activity";
import { webhookRouter } from "../../src/routers/webhook";
import { createTestDb, type TestDb } from "./db";
import { testContext } from "./context";

let db: TestDb;
let dbAs: Database;
const now = new Date();

/** Admin of oA. A second organization (oB) exists purely to be intruded upon. */
const ctx = () => testContext(db, { userId: "u1", activeOrganizationId: "oA" });

beforeAll(async () => {
  db = await createTestDb();
  dbAs = db as unknown as Database;
  await db.insert(user).values({
    id: "u1",
    name: "Ada",
    email: "ada@example.test",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(organization).values([
    { id: "oA", name: "Acme", slug: "acme", createdAt: now },
    { id: "oB", name: "Other", slug: "other", createdAt: now },
  ]);
  await db.insert(member).values({ id: "mA", organizationId: "oA", userId: "u1", createdAt: now });
  await db.insert(space).values([
    { id: "s1", organizationId: "oA", slug: "s1", name: "Handbuch", createdBy: "u1" },
    { id: "s2", organizationId: "oA", slug: "s2", name: "Intern", createdBy: "u1" },
  ]);
});
afterAll(async () => {
  await db.$end();
});
beforeEach(async () => {
  hasPermission.mockReset();
  hasPermission.mockResolvedValue({ success: true });
  await db.delete(webhookDelivery);
  await db.delete(webhook);
});

describe("authorization", () => {
  it("refuses every procedure to a caller without organization:update", async () => {
    hasPermission.mockResolvedValue({ success: false });
    const context = ctx();
    const calls = [
      call(webhookRouter.list, {}, { context }),
      call(webhookRouter.listEvents, {}, { context }),
      call(
        webhookRouter.create,
        { name: "X", url: "https://hooks.example.com/a", events: ["page.created"], active: true },
        { context },
      ),
      call(webhookRouter.update, { id: "any", name: "X" }, { context }),
      call(webhookRouter.delete, { id: "any" }, { context }),
      call(webhookRouter.test, { id: "any" }, { context }),
      call(webhookRouter.listDeliveries, { webhookId: "any", limit: 25 }, { context }),
    ];
    for (const pending of calls) {
      await expect(pending).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

describe("secret handling", () => {
  it("returns the secret once on create and only a prefix afterwards", async () => {
    const created = await call(
      webhookRouter.create,
      {
        name: "Slack",
        url: "https://hooks.example.com/services/abc",
        events: ["page.created"],
        active: true,
      },
      { context: ctx() },
    );
    expect(created.secret).toMatch(/^whsec_/);

    const [listed] = await call(webhookRouter.list, {}, { context: ctx() });
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("secret");
    expect(listed!.secretPreview).toBe(`${created.secret.slice(0, 12)}…`);
    // The preview must not be enough to sign with.
    expect(created.secret.startsWith(listed!.secretPreview.slice(0, -1))).toBe(true);
    expect(listed!.secretPreview.length).toBeLessThan(created.secret.length);
  });

  it("rejects an endpoint inside the private network", async () => {
    await expect(
      call(
        webhookRouter.create,
        {
          name: "Datenbank",
          url: "http://localhost:5432/",
          events: ["page.created"],
          active: true,
        },
        { context: ctx() },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("tenant isolation", () => {
  it("neither reads nor changes another organization's webhook", async () => {
    const [foreign] = await db
      .insert(webhook)
      .values({
        organizationId: "oB",
        name: "Fremd",
        url: "https://hooks.example.com/other",
        secret: "whsec_other",
        events: ["page.created"],
      })
      .returning();

    const context = ctx();
    await expect(call(webhookRouter.list, {}, { context })).resolves.toEqual([]);
    await expect(
      call(webhookRouter.update, { id: foreign!.id, name: "Gekapert" }, { context }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(webhookRouter.delete, { id: foreign!.id }, { context }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(webhookRouter.listDeliveries, { webhookId: foreign!.id, limit: 25 }, { context }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(call(webhookRouter.test, { id: foreign!.id }, { context })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Still there, unmodified.
    const stored = await db.query.webhook.findFirst({ where: eq(webhook.id, foreign!.id) });
    expect(stored?.name).toBe("Fremd");
  });
});

describe("fan-out from recordActivity", () => {
  /** Creates the four subscriptions the cases below distinguish between. */
  async function seedSubscriptions() {
    await db.insert(webhook).values([
      {
        id: "wMatch",
        organizationId: "oA",
        name: "Passend",
        url: "https://hooks.example.com/1",
        secret: "s",
        events: ["page.created", "page.updated"],
      },
      {
        id: "wOtherEvent",
        organizationId: "oA",
        name: "Anderes Ereignis",
        url: "https://hooks.example.com/2",
        secret: "s",
        events: ["comment.created"],
      },
      {
        id: "wInactive",
        organizationId: "oA",
        name: "Pausiert",
        url: "https://hooks.example.com/3",
        secret: "s",
        events: ["page.created"],
        active: false,
      },
      {
        id: "wOtherSpace",
        organizationId: "oA",
        name: "Anderer Space",
        url: "https://hooks.example.com/4",
        secret: "s",
        events: ["page.created"],
        spaceId: "s2",
      },
      {
        id: "wOtherOrg",
        organizationId: "oB",
        name: "Andere Org",
        url: "https://hooks.example.com/5",
        secret: "s",
        events: ["page.created"],
      },
    ]);
  }

  it("queues exactly one delivery per matching active webhook", async () => {
    await seedSubscriptions();
    await recordActivity(dbAs, {
      organizationId: "oA",
      action: "page.created",
      actorId: "u1",
      spaceId: "s1",
    });

    const rows = await db.select().from(webhookDelivery);
    expect(rows.map((row) => row.webhookId)).toEqual(["wMatch"]);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempts).toBe(0);
    expect(rows[0]!.activityId).not.toBeNull();
  });

  it("reaches a space-scoped webhook only for its own space", async () => {
    await seedSubscriptions();
    await recordActivity(dbAs, {
      organizationId: "oA",
      action: "page.created",
      actorId: "u1",
      spaceId: "s2",
    });

    const rows = await db.select().from(webhookDelivery);
    expect(rows.map((row) => row.webhookId).sort()).toEqual(["wMatch", "wOtherSpace"]);
  });

  it("does not deliver webhook administration itself", async () => {
    await db.insert(webhook).values({
      id: "wAll",
      organizationId: "oA",
      name: "Alles",
      url: "https://hooks.example.com/all",
      secret: "s",
      events: ["webhook.created", "page.created"],
    });
    await recordActivity(dbAs, {
      organizationId: "oA",
      action: "webhook.created",
      actorId: "u1",
    });
    expect(await db.select().from(webhookDelivery)).toEqual([]);
  });

  it("leaves no delivery behind when the transaction rolls back", async () => {
    await seedSubscriptions();
    await expect(
      db.transaction(async (tx) => {
        await recordActivity(tx as unknown as Database, {
          organizationId: "oA",
          action: "page.created",
          actorId: "u1",
          spaceId: "s1",
        });
        // Something later in the mutation fails — the event never happened.
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await db.select().from(webhookDelivery)).toEqual([]);
  });
});
