import { beforeEach, describe, expect, it, vi } from "vitest";

import { isPdf, pdfEmbedsImage, pdfPageCount, pngFixture } from "./helpers/pdf";
import {
  archiveEntries,
  attachmentRow,
  exportContext,
  exportEnv,
  pageRow,
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

import { spaceExportRoutes } from "../src/space-exports";

const imagePage = (id: string) =>
  pageRow(id, {
    content: {
      type: "doc",
      content: [{ type: "image", attrs: { src: "/attachments/a1/inline", alt: "Diagramm" } }],
    },
  });

describe("PDF Space export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.env, exportEnv());
    mocks.requireSpaceCapability.mockResolvedValue(undefined);
    mocks.getStorage.mockReturnValue(null);
  });

  it("writes one valid PDF per page, in the layout the other formats use", async () => {
    const pages = [pageRow("p1"), pageRow("p2", { parentId: "p1" })];
    mocks.createContext.mockResolvedValue(exportContext({ pages }));
    const pdfEntries = await archiveEntries(
      await spaceExportRoutes.request("/spaces/s1?format=pdf"),
    );

    mocks.createContext.mockResolvedValue(exportContext({ pages }));
    const jsonEntries = await archiveEntries(
      await spaceExportRoutes.request("/spaces/s1?format=json"),
    );

    const directories = (entries: Record<string, Uint8Array>) =>
      Object.keys(entries)
        .filter((name) => name.startsWith("pages/"))
        .map((name) => name.slice(0, name.lastIndexOf("/")))
        .sort();
    expect(directories(pdfEntries)).toEqual(directories(jsonEntries));

    const bodies = Object.entries(pdfEntries).filter(([name]) => name.endsWith(".pdf"));
    expect(bodies).toHaveLength(2);
    for (const [, bytes] of bodies) {
      expect(isPdf(bytes)).toBe(true);
      expect(pdfPageCount(bytes)).toBeGreaterThan(0);
    }
  });

  it("embeds an image from the object store into the page PDF", async () => {
    const png = pngFixture(48, 48);
    const attachment = attachmentRow({
      fileName: "diagram.png",
      mimeType: "image/png",
      size: png.length,
    });
    mocks.createContext.mockResolvedValue(
      exportContext({ pages: [imagePage("p1")], attachments: [attachment] }),
    );
    mocks.getStorage.mockReturnValue({
      download: vi.fn().mockResolvedValue({ stream: streamOf(png) }),
    });

    const entries = await archiveEntries(await spaceExportRoutes.request("/spaces/s1?format=pdf"));
    const body = Object.entries(entries).find(([name]) => name.endsWith(".pdf"))![1];
    expect(pdfEmbedsImage(body)).toBe(true);
    expect(body.length).toBeGreaterThan(png.length);
  });

  it("enforces the configured page ceiling and makes it visible in the archive", async () => {
    mocks.env.PDF_EXPORT_MAX_PAGES = 1;
    mocks.createContext.mockResolvedValue(exportContext({ pages: [pageRow("p1"), pageRow("p2")] }));

    const entries = await archiveEntries(await spaceExportRoutes.request("/spaces/s1?format=pdf"));
    const report = Buffer.from(entries["EXPORT-REPORT.md"]!).toString("utf8");
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]!).toString("utf8"));

    expect(report).toContain("skipped");
    expect(report).toContain("Obergrenze");
    expect(manifest.limits).toMatchObject({ maxPages: 1, skippedPageIds: ["p2"] });
    expect(manifest.pages[1].warnings[0]).toContain("Obergrenze");
    // The skipped page still has a file at its path: the archive layout never
    // silently loses an entry.
    const skipped = entries[manifest.pages[1].path]!;
    expect(isPdf(skipped)).toBe(true);
    expect(pdfPageCount(skipped)).toBe(1);
  });

  it("degrades a page that exceeds its timeout to an explained placeholder", async () => {
    mocks.env.PDF_EXPORT_PAGE_TIMEOUT_MS = 1000;
    const png = pngFixture();
    mocks.createContext.mockResolvedValue(
      exportContext({
        pages: [imagePage("p1")],
        attachments: [attachmentRow({ mimeType: "image/png", size: png.length })],
      }),
    );
    mocks.getStorage.mockReturnValue({
      download: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return { stream: streamOf(png) };
      }),
    });

    const entries = await archiveEntries(await spaceExportRoutes.request("/spaces/s1?format=pdf"));
    const report = Buffer.from(entries["EXPORT-REPORT.md"]!).toString("utf8");
    const body = Object.entries(entries).find(([name]) => name.endsWith(".pdf"))![1];

    expect(report).toContain("timeout");
    expect(report).toContain("Zeitlimit");
    expect(isPdf(body)).toBe(true);
  }, 15000);
});
