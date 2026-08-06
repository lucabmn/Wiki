import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three health routes, isolated from every dependency they probe.
 *
 * What matters here is the routing of failure onto status codes: an
 * orchestrator must not restart the API because object storage hiccuped, and
 * monitoring must not read "ok" while half the deployment is unreachable. Both
 * were true of the single `/health` this replaced.
 */

const { pingDb, list, isStorageConfigured, isMailConfigured, fetchMock } = vi.hoisted(() => ({
  pingDb: vi.fn(async () => {}),
  list: vi.fn(async () => ({ items: [] })),
  isStorageConfigured: vi.fn(() => true),
  isMailConfigured: vi.fn(() => true),
  fetchMock: vi.fn(async () => new Response("upgrade required", { status: 426 })),
}));

vi.mock("@nilovon-wiki/db", () => ({ pingDb }));
vi.mock("@nilovon-wiki/api/lib/storage", () => ({
  isStorageConfigured,
  getStorage: () => ({ list }),
}));
vi.mock("@nilovon-wiki/auth/mail", () => ({ isMailConfigured }));
vi.mock("@nilovon-wiki/env/server", () => ({
  env: { COLLAB_INTERNAL_URL: "http://collab.test:1234", COLLAB_PORT: 1234 },
}));
vi.mock("evlog", () => ({ log: { warn: vi.fn() }, parseError: () => ({}) }));

const { healthRoutes } = await import("../src/health");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  pingDb.mockResolvedValue(undefined);
  list.mockResolvedValue({ items: [] });
  isStorageConfigured.mockReturnValue(true);
  isMailConfigured.mockReturnValue(true);
  fetchMock.mockResolvedValue(new Response("upgrade required", { status: 426 }));
});

const get = (path: string) => healthRoutes.request(path);

describe("GET /health/live", () => {
  it("answers without touching a single dependency", async () => {
    pingDb.mockRejectedValue(new Error("database is gone"));
    const response = await get("/health/live");
    expect(response.status).toBe(200);
    // Restarting the process would not bring the database back, so a dead
    // database must never look like a dead process.
    expect(pingDb).not.toHaveBeenCalled();
  });
});

describe("GET /health", () => {
  it("is ok while the database answers", async () => {
    const response = await get("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("is 503 when the database is unreachable", async () => {
    pingDb.mockRejectedValue(new Error("connection refused"));
    const response = await get("/health");
    expect(response.status).toBe(503);
  });

  it("stays ok when only storage or collab are down", async () => {
    // The point of the split: neither failure is fixed by restarting the API,
    // and an orchestrator that cycles the container makes the incident worse.
    list.mockRejectedValue(new Error("no such bucket"));
    fetchMock.mockRejectedValue(new Error("connection refused"));
    expect((await get("/health")).status).toBe(200);
  });
});

describe("GET /health/ready", () => {
  it("reports every dependency when all of them answer", async () => {
    const response = await get("/health/ready");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: {
        database: { status: "ok" },
        // Any HTTP reply proves the WebSocket server is listening — a 426 is
        // exactly what a plain GET should get.
        collab: { status: "ok" },
        storage: { status: "ok" },
        mail: { status: "ok" },
      },
    });
  });

  it("degrades to 503 when object storage is unreachable", async () => {
    list.mockRejectedValue(new Error("no such bucket"));
    const response = await get("/health/ready");
    expect(response.status).toBe(503);
    const body = (await response.json()) as { status: string; checks: Record<string, unknown> };
    expect(body.status).toBe("degraded");
    expect(body.checks.storage).toEqual({ status: "unreachable", detail: "no such bucket" });
    // The gap this endpoint exists to close: the rest still works, and the
    // report has to say so rather than collapsing to one boolean.
    expect(body.checks.database).toEqual({ status: "ok" });
  });

  it("degrades to 503 when the collaboration service is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const response = await get("/health/ready");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      checks: { collab: { status: "unreachable" } },
    });
  });

  it("calls an unconfigured dependency disabled rather than broken", async () => {
    // An install without attachments is a supported configuration, not an
    // outage — reporting it as one would train operators to ignore the page.
    isStorageConfigured.mockReturnValue(false);
    isMailConfigured.mockReturnValue(false);
    const response = await get("/health/ready");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: { storage: { status: "disabled" }, mail: { status: "disabled" } },
    });
  });
});
