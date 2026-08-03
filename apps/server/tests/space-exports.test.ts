import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requireSpaceCapability: vi.fn(),
  getStorage: vi.fn(),
}));

vi.mock("@nilovon-wiki/api/context", () => ({ createContext: mocks.createContext }));
vi.mock("@nilovon-wiki/api/lib/authz", () => ({
  requireSpaceCapability: mocks.requireSpaceCapability,
}));
vi.mock("@nilovon-wiki/api/lib/storage", () => ({ getStorage: mocks.getStorage }));

import { resolveArchiveUrl, spaceExportRoutes } from "../src/space-exports";

const space = {
  id: "s1",
  organizationId: "o1",
  slug: "handbook",
  name: "Handbook",
  description: null,
  icon: null,
  color: null,
  visibility: "private",
  createdBy: "u1",
  archivedAt: null,
  deletionPendingAt: null as Date | null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-02T00:00:00Z"),
};

function context() {
  const query = {
    space: { findFirst: vi.fn().mockResolvedValue(space) },
    page: { findMany: vi.fn().mockResolvedValue([]) },
    tag: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const select = vi
    .fn()
    .mockImplementationOnce(() => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ orderBy: () => Promise.resolve([]) }),
        }),
      }),
    }));
  const tx = { query, select };
  return {
    session: { user: { id: "u1" } },
    headers: new Headers(),
    db: {
      query,
      select,
      transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    },
  };
}

describe("portable export links", () => {
  const pagePaths = new Map([["p1", "pages/one--p1/content.md"]]);
  const attachmentPaths = new Map([["a1", "attachments/a1/file.pdf"]]);

  it("rewrites only local internal links and retains fragments", () => {
    expect(resolveArchiveUrl("/pages/p1#section", pagePaths, attachmentPaths)).toBe(
      "../one--p1/content.md#section",
    );
    expect(resolveArchiveUrl("/attachments/a1/download", pagePaths, attachmentPaths)).toBe(
      "../../attachments/a1/file.pdf",
    );
    expect(resolveArchiveUrl("https://example.test/pages/p1", pagePaths, attachmentPaths)).toBe(
      "https://example.test/pages/p1",
    );
  });

  it("does not throw on malformed percent escapes", () => {
    expect(resolveArchiveUrl("/pages/%", pagePaths, attachmentPaths)).toBe("/pages/%");
  });
});

describe("Space export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createContext.mockResolvedValue(context());
    mocks.requireSpaceCapability.mockResolvedValue(undefined);
    mocks.getStorage.mockReturnValue(null);
  });

  it("rejects invalid formats before querying authenticated data", async () => {
    const response = await spaceExportRoutes.request("/spaces/s1?format=pdf");
    expect(response.status).toBe(400);
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  it("returns a private ZIP only after the Space manage gate", async () => {
    const response = await spaceExportRoutes.request("/spaces/s1?format=json");
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(mocks.requireSpaceCapability).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("handbook-json-export.zip");
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe("PK");
  });

  it("maps a failed Space manage gate to forbidden", async () => {
    mocks.requireSpaceCapability.mockRejectedValue(new ORPCError("FORBIDDEN"));
    const response = await spaceExportRoutes.request("/spaces/s1?format=markdown");
    expect(response.status).toBe(403);
  });

  it("refuses an archive while deletion is pending", async () => {
    const pending = context();
    pending.db.query.space.findFirst.mockResolvedValue({
      ...space,
      deletionPendingAt: new Date("2025-01-03T00:00:00Z"),
    });
    mocks.createContext.mockResolvedValue(pending);

    const response = await spaceExportRoutes.request("/spaces/s1?format=html");
    expect(response.status).toBe(409);
  });

  it("opens attachment storage lazily and verifies the streamed size", async () => {
    const withAttachment = context();
    withAttachment.db.query.attachment.findMany.mockResolvedValue([
      {
        id: "a1",
        spaceId: "s1",
        pageId: null,
        fileName: "proof.bin",
        mimeType: "application/octet-stream",
        size: 2,
        storageKey: "spaces/s1/a1.bin",
        checksum: null,
        uploadedBy: "u1",
        isDraft: false,
        publishOnNextPublish: false,
        deletionPendingAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ]);
    mocks.createContext.mockResolvedValue(withAttachment);
    const download = vi.fn().mockResolvedValue({
      stream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.from([1, 2]));
            controller.close();
          },
        }),
    });
    mocks.getStorage.mockReturnValue({ download });

    const response = await spaceExportRoutes.request("/spaces/s1?format=json");
    expect(download).not.toHaveBeenCalled();
    await response.arrayBuffer();
    expect(download).toHaveBeenCalledOnce();
  });

  it("aborts the ZIP when attachment bytes do not match metadata", async () => {
    const withAttachment = context();
    withAttachment.db.query.attachment.findMany.mockResolvedValue([
      {
        id: "a1",
        spaceId: "s1",
        pageId: null,
        fileName: "short.bin",
        mimeType: "application/octet-stream",
        size: 3,
        storageKey: "spaces/s1/a1.bin",
        checksum: null,
        uploadedBy: "u1",
        isDraft: false,
        publishOnNextPublish: false,
        deletionPendingAt: null,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ]);
    mocks.createContext.mockResolvedValue(withAttachment);
    mocks.getStorage.mockReturnValue({
      download: vi.fn().mockResolvedValue({
        stream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.from([1, 2]));
              controller.close();
            },
          }),
      }),
    });

    const response = await spaceExportRoutes.request("/spaces/s1?format=json");
    await expect(response.arrayBuffer()).rejects.toThrow("size mismatch");
  });
});
