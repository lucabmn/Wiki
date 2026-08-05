import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachmentRow,
  exportContext,
  exportEnv,
  spaceFixture,
  streamOf,
} from "./helpers/space-export";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requireSpaceCapability: vi.fn(),
  getStorage: vi.fn(),
  env: {
    ATTACHMENT_MAX_MB: 25,
    PDF_EXPORT_MAX_PAGES: 500,
    PDF_EXPORT_PAGE_TIMEOUT_MS: 15000,
    PDF_EXPORT_IMAGE_CACHE_MB: 64,
  },
}));

vi.mock("@nilovon-wiki/api/context", () => ({ createContext: mocks.createContext }));
vi.mock("@nilovon-wiki/api/lib/authz", () => ({
  requireSpaceCapability: mocks.requireSpaceCapability,
}));
vi.mock("@nilovon-wiki/api/lib/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@nilovon-wiki/env/server", () => ({ env: mocks.env }));

import { resolveArchiveUrl, spaceExportRoutes } from "../src/space-exports";

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
    Object.assign(mocks.env, exportEnv());
    mocks.createContext.mockResolvedValue(exportContext());
    mocks.requireSpaceCapability.mockResolvedValue(undefined);
    mocks.getStorage.mockReturnValue(null);
  });

  it("rejects invalid formats before querying authenticated data", async () => {
    const response = await spaceExportRoutes.request("/spaces/s1?format=docx");
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

  it("does not disclose a Space from another organization", async () => {
    const foreign = exportContext();
    foreign.db.query.space.findFirst.mockResolvedValue(undefined);
    mocks.createContext.mockResolvedValue(foreign);

    const response = await spaceExportRoutes.request("/spaces/other?format=pdf");
    expect(response.status).toBe(404);
    expect(mocks.requireSpaceCapability).not.toHaveBeenCalled();
  });

  it("treats a trashed Space as missing rather than exporting it", async () => {
    const trashed = exportContext();
    trashed.db.query.space.findFirst.mockResolvedValue({
      ...spaceFixture,
      deletedAt: new Date("2025-01-03T00:00:00Z"),
    });
    mocks.createContext.mockResolvedValue(trashed);

    const response = await spaceExportRoutes.request("/spaces/s1?format=pdf");
    expect(response.status).toBe(404);
    expect(mocks.requireSpaceCapability).not.toHaveBeenCalled();
  });

  it("refuses an archive while deletion is pending", async () => {
    const pending = exportContext();
    pending.db.query.space.findFirst.mockResolvedValue({
      ...spaceFixture,
      deletionPendingAt: new Date("2025-01-03T00:00:00Z"),
    });
    mocks.createContext.mockResolvedValue(pending);

    const response = await spaceExportRoutes.request("/spaces/s1?format=html");
    expect(response.status).toBe(409);
  });

  it("opens attachment storage lazily and verifies the streamed size", async () => {
    mocks.createContext.mockResolvedValue(exportContext({ attachments: [attachmentRow()] }));
    const download = vi.fn().mockResolvedValue({ stream: streamOf(Uint8Array.from([1, 2])) });
    mocks.getStorage.mockReturnValue({ download });

    const response = await spaceExportRoutes.request("/spaces/s1?format=json");
    expect(download).not.toHaveBeenCalled();
    await response.arrayBuffer();
    expect(download).toHaveBeenCalledOnce();
  });

  it("aborts the ZIP when attachment bytes do not match metadata", async () => {
    mocks.createContext.mockResolvedValue(
      exportContext({ attachments: [attachmentRow({ size: 3, fileName: "short.bin" })] }),
    );
    mocks.getStorage.mockReturnValue({
      download: vi.fn().mockResolvedValue({ stream: streamOf(Uint8Array.from([1, 2])) }),
    });

    const response = await spaceExportRoutes.request("/spaces/s1?format=json");
    await expect(response.arrayBuffer()).rejects.toThrow("size mismatch");
  });
});
