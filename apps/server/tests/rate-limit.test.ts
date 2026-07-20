import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimit } from "../src/rate-limit";

function appWith(options: Parameters<typeof rateLimit>[0]) {
  const app = new Hono();
  app.use("*", rateLimit(options));
  app.get("/", (c) => c.text("ok"));
  return app;
}

const from = (app: Hono, ip?: string) =>
  app.request("/", { headers: ip ? { "x-forwarded-for": ip } : {} });

afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows requests up to the limit and rejects the next one", async () => {
    const app = appWith({ max: 2, keyPrefix: "t" });
    expect((await from(app, "1.1.1.1")).status).toBe(200);
    expect((await from(app, "1.1.1.1")).status).toBe(200);
    const blocked = await from(app, "1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("reports the remaining budget", async () => {
    const app = appWith({ max: 3, keyPrefix: "t" });
    const first = await from(app, "2.2.2.2");
    expect(first.headers.get("RateLimit-Limit")).toBe("3");
    expect(first.headers.get("RateLimit-Remaining")).toBe("2");
  });

  it("counts each client address separately", async () => {
    const app = appWith({ max: 1, keyPrefix: "t" });
    expect((await from(app, "3.3.3.3")).status).toBe(200);
    expect((await from(app, "4.4.4.4")).status).toBe(200);
    expect((await from(app, "3.3.3.3")).status).toBe(429);
  });

  it("trusts only the last X-Forwarded-For entry", async () => {
    // The proxy appends the real peer; earlier entries are client-supplied, so
    // taking the first would let an attacker rotate spoofed IPs to dodge the
    // limit. Both requests below must land in the same bucket.
    const app = appWith({ max: 1, keyPrefix: "t" });
    expect((await from(app, "9.9.9.9, 5.5.5.5")).status).toBe(200);
    expect((await from(app, "8.8.8.8, 5.5.5.5")).status).toBe(429);
  });

  it("shares one bucket for requests with no forwarded address", async () => {
    const app = appWith({ max: 1, keyPrefix: "t" });
    expect((await from(app)).status).toBe(200);
    expect((await from(app)).status).toBe(429);
  });

  it("charges a weighted request for everything it bundles", async () => {
    // A batched RPC call carries up to 10 calls; without the weight, batching
    // would multiply the effective limit tenfold.
    const app = appWith({ max: 10, keyPrefix: "t", weight: () => 10 });
    expect((await from(app, "6.6.6.6")).status).toBe(200);
    expect((await from(app, "6.6.6.6")).status).toBe(429);
  });

  it("never charges less than one per request", async () => {
    const app = appWith({ max: 1, keyPrefix: "t", weight: () => 0 });
    expect((await from(app, "7.7.7.7")).status).toBe(200);
    expect((await from(app, "7.7.7.7")).status).toBe(429);
  });

  it("starts a fresh window once the old one expires", async () => {
    vi.useFakeTimers();
    const app = appWith({ max: 1, keyPrefix: "t" });
    expect((await from(app, "1.2.3.4")).status).toBe(200);
    expect((await from(app, "1.2.3.4")).status).toBe(429);
    vi.advanceTimersByTime(61_000);
    expect((await from(app, "1.2.3.4")).status).toBe(200);
  });
});
