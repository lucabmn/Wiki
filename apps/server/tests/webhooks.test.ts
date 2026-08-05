import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The HTTP trigger, isolated from the runner it drives.
 *
 * `runDueWebhooks` itself is exercised against a real database in
 * `packages/api/tests/integration/webhook-runner.test.ts` — what matters here is
 * the door in front of it: an unauthenticated caller must not be able to drain
 * the queue, and the historic `DIGEST_RUN_TOKEN` must keep opening it.
 */

const { RUN_TOKEN, runDueWebhooks } = vi.hoisted(() => ({
  RUN_TOKEN: "internal-run-token-0123456789",
  runDueWebhooks: vi.fn(async () => ({ claimed: 0, delivered: 0, retrying: 0, failed: 0 })),
}));
vi.mock("@nilovon-wiki/api/lib/webhooks/run", () => ({ runDueWebhooks }));
vi.mock("@nilovon-wiki/db", () => ({ db: {} }));
vi.mock("@nilovon-wiki/env/server", () => ({
  env: { WEBHOOK_SCHEDULER_ENABLED: false, WEBHOOK_TICK_SECONDS: 30 },
  internalRunToken: RUN_TOKEN,
}));

import { webhookRoutes } from "../src/webhooks";

const post = (token?: string) =>
  webhookRoutes.request("/webhooks/run", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

beforeEach(() => {
  runDueWebhooks.mockClear();
});

describe("POST /internal/webhooks/run", () => {
  it("runs a batch for a caller with the token", async () => {
    const response = await post(RUN_TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", claimed: 0 });
    expect(runDueWebhooks).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing or wrong token without touching the queue", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("wrong-token-but-same-length!!")).status).toBe(401);
    expect(runDueWebhooks).not.toHaveBeenCalled();
  });

  it("answers 202 instead of piling a second batch on the first", async () => {
    // A run that has not finished yet: the next trigger must be told to come
    // back rather than start a parallel batch over the same rows.
    let release = () => {};
    runDueWebhooks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ claimed: 1, delivered: 1, retrying: 0, failed: 0 });
        }),
    );

    const first = post(RUN_TOKEN);
    const second = await post(RUN_TOKEN);
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ status: "busy" });

    release();
    expect((await first).status).toBe(200);
    expect(runDueWebhooks).toHaveBeenCalledTimes(1);
  });
});
