import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@nilovon-wiki/db";
import {
  activity,
  organization,
  space,
  user,
  webhook,
  webhookDelivery,
} from "@nilovon-wiki/db/schema/index";

import { deliverWebhook } from "../../src/lib/webhooks/deliver";
import type { WebhookEventPayload } from "../../src/lib/webhooks/payload";
import { runDueWebhooks } from "../../src/lib/webhooks/run";
import { signWebhookPayload, verifyWebhookSignature } from "../../src/lib/webhooks/signature";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
let dbAs: Database;
const now = new Date("2026-08-04T10:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
  dbAs = db as unknown as Database;
  await db
    .insert(user)
    .values({ id: "u1", name: "Ada", email: "ada@example.test", createdAt: now, updatedAt: now });
  await db.insert(organization).values({ id: "oA", name: "Acme", slug: "acme", createdAt: now });
  await db
    .insert(space)
    .values({ id: "s1", organizationId: "oA", slug: "s1", name: "Handbuch", createdBy: "u1" });
  await db.insert(webhook).values({
    id: "w1",
    organizationId: "oA",
    name: "Ziel",
    url: "https://hooks.example.com/1",
    secret: "whsec_test",
    events: ["page.created"],
  });
});
afterAll(async () => {
  await db.$end();
});
beforeEach(async () => {
  await db.delete(webhookDelivery);
  await db.delete(activity);
});

/** One queued delivery with a real audit row behind it. */
async function queueDelivery(overrides: Partial<typeof webhookDelivery.$inferInsert> = {}) {
  const [event] = await db
    .insert(activity)
    .values({
      organizationId: "oA",
      action: "page.created",
      actorId: "u1",
      spaceId: "s1",
      metadata: { title: "Startseite" },
    })
    .returning();
  const [row] = await db
    .insert(webhookDelivery)
    .values({ webhookId: "w1", activityId: event!.id, nextAttemptAt: now, ...overrides })
    .returning();
  return row!;
}

const ok = () => ({ ok: true, responseStatus: 200, error: null });
const serverError = () => ({ ok: false, responseStatus: 500, error: "HTTP 500" });

describe("claiming", () => {
  it("does not deliver twice when two runs overlap", async () => {
    await queueDelivery();
    const send = vi.fn(async () => ok());

    const [first, second] = await Promise.all([
      runDueWebhooks(dbAs, { now, send }),
      runDueWebhooks(dbAs, { now, send }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(first!.claimed + second!.claimed).toBe(1);
    expect(first!.delivered + second!.delivered).toBe(1);

    const [row] = await db.select().from(webhookDelivery);
    expect(row!.status).toBe("delivered");
    expect(row!.responseStatus).toBe(200);
    expect(row!.claimedAt).toBeNull();
  });

  it("ignores a delivery that is not due yet", async () => {
    await queueDelivery({ nextAttemptAt: new Date(now.getTime() + 60_000) });
    const send = vi.fn(async () => ok());
    const summary = await runDueWebhooks(dbAs, { now, send });
    expect(summary.claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("retries", () => {
  it("keeps a 500 pending, records the error and backs off", async () => {
    const queued = await queueDelivery();
    const summary = await runDueWebhooks(dbAs, { now, send: async () => serverError() });

    expect(summary).toMatchObject({ claimed: 1, delivered: 0, retrying: 1, failed: 0 });
    const row = await db.query.webhookDelivery.findFirst({
      where: eq(webhookDelivery.id, queued.id),
    });
    // Nothing is lost: the row is still pending, with the reason and a later slot.
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(1);
    expect(row!.responseStatus).toBe(500);
    expect(row!.lastError).toBe("HTTP 500");
    expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(row!.claimedAt).toBeNull();
  });

  it("gives up once the attempt ceiling is reached", async () => {
    // One attempt short of the ceiling, so this run is the last one.
    const queued = await queueDelivery({ attempts: 5 });
    const summary = await runDueWebhooks(dbAs, { now, send: async () => serverError() });

    expect(summary).toMatchObject({ retrying: 0, failed: 1 });
    const row = await db.query.webhookDelivery.findFirst({
      where: eq(webhookDelivery.id, queued.id),
    });
    expect(row!.status).toBe("failed");
    expect(row!.nextAttemptAt).toBeNull();
    expect(row!.lastError).toBe("HTTP 500");
  });

  it("retries a claim whose lease has expired", async () => {
    // A run that crashed mid-batch six minutes ago left the claim behind.
    await queueDelivery({ claimedAt: new Date(now.getTime() - 6 * 60 * 1000) });
    const send = vi.fn(async () => ok());
    const summary = await runDueWebhooks(dbAs, { now, send });
    expect(summary.claimed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("payload", () => {
  it("carries the resolved event context", async () => {
    await queueDelivery();
    // Typed parameter so the assertion below reads the payload off the call.
    const send = vi.fn(async (_input: { payload: WebhookEventPayload }) => ok());
    await runDueWebhooks(dbAs, { now, send });

    const payload = send.mock.calls[0]![0].payload;
    expect(payload).toMatchObject({
      event: "page.created",
      organization: { id: "oA", name: "Acme" },
      actor: { id: "u1", name: "Ada" },
      space: { id: "s1", slug: "s1", name: "Handbuch" },
      metadata: { title: "Startseite" },
    });
  });
});

describe("signature", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs timestamp + '.' + body and verifies", () => {
    const signature = signWebhookPayload({
      secret: "whsec_test",
      timestamp: 1000,
      body: '{"a":1}',
    });
    expect(signature).toBe(
      `sha256=${createHmac("sha256", "whsec_test").update('1000.{"a":1}').digest("hex")}`,
    );
    expect(
      verifyWebhookSignature({
        secret: "whsec_test",
        timestamp: 1000,
        body: '{"a":1}',
        signature,
      }),
    ).toBe(true);
    // A replay under a different timestamp must not verify — that is the whole
    // point of binding it into the MAC.
    expect(
      verifyWebhookSignature({
        secret: "whsec_test",
        timestamp: 1001,
        body: '{"a":1}',
        signature,
      }),
    ).toBe(false);
  });

  it("sends headers a receiver can verify the body against", async () => {
    const captured: { headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      captured.push({
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      });
      return new Response(null, { status: 204 });
    });

    // A public IP literal: it needs no DNS, so the target check stays offline.
    const result = await deliverWebhook({
      url: "https://93.184.216.34/hook",
      secret: "whsec_test",
      payload: {
        id: "d1",
        event: "page.created",
        at: now.toISOString(),
        organization: { id: "oA", name: "Acme" },
        actor: null,
        space: null,
        page: null,
        metadata: null,
      },
      attempt: 1,
    });

    expect(result).toMatchObject({ ok: true, responseStatus: 204 });
    const sent = captured[0]!;
    const timestamp = Number(sent.headers["X-Wiki-Timestamp"]);
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: "whsec_test",
        timestamp,
        body: sent.body,
        signature: sent.headers["X-Wiki-Signature"]!,
      }),
    ).toBe(true);
    // A tampered body must not verify under the same signature.
    expect(
      verifyWebhookSignature({
        secret: "whsec_test",
        timestamp,
        body: `${sent.body} `,
        signature: sent.headers["X-Wiki-Signature"]!,
      }),
    ).toBe(false);
  });
});
