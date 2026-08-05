import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isPdf, pdfEmbedsImage, pdfLinksTo, pdfPageCount, pngFixture } from "./helpers/pdf";
import { streamOf } from "./helpers/space-export";

const mocks = vi.hoisted(() => ({
  createContext: vi.fn(),
  requirePageCapability: vi.fn(),
  loadPage: vi.fn(),
  loadSpace: vi.fn(),
  getStorage: vi.fn(),
  assertTwoFactorCompliance: vi.fn(),
  call: vi.fn(),
  // Inline rather than shared: `vi.hoisted` runs before module imports.
  env: {
    CORS_ORIGIN: "https://wiki.test",
    ATTACHMENT_MAX_MB: 25,
    PDF_EXPORT_MAX_PAGES: 500,
    PDF_EXPORT_PAGE_TIMEOUT_MS: 15000,
    PDF_EXPORT_IMAGE_CACHE_MB: 64,
  },
}));

vi.mock("@nilovon-wiki/api/context", () => ({ createContext: mocks.createContext }));
vi.mock("@nilovon-wiki/api/lib/authz", () => ({
  requirePageCapability: mocks.requirePageCapability,
}));
vi.mock("@nilovon-wiki/api/lib/loaders", () => ({
  loadPage: mocks.loadPage,
  loadSpace: mocks.loadSpace,
}));
vi.mock("@nilovon-wiki/api/lib/storage", () => ({ getStorage: mocks.getStorage }));
vi.mock("@nilovon-wiki/api/lib/two-factor-policy", () => ({
  assertTwoFactorCompliance: mocks.assertTwoFactorCompliance,
}));
vi.mock("@nilovon-wiki/api/routers/index", () => ({ appRouter: { attachments: { get: {} } } }));
vi.mock("@nilovon-wiki/env/server", () => ({ env: mocks.env }));
vi.mock("@orpc/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@orpc/server")>()),
  call: mocks.call,
}));

import { pageExportRoutes } from "../src/page-exports";

const page = {
  id: "p1",
  spaceId: "s1",
  title: "Notfallhandbuch",
  slug: "notfallhandbuch",
  createdBy: "u1",
  visibility: "private",
  textContent: "Inhalt",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Siehe ", marks: [] },
          { type: "text", text: "Anhang", marks: [{ type: "link", attrs: { href: "/pages/p2" } }] },
        ],
      },
      { type: "image", attrs: { src: "/attachments/a1/inline", alt: "Diagramm" } },
    ],
  },
};

const spaceRow = { id: "s1", organizationId: "o1", name: "Handbuch", slug: "handbuch" };

describe("single-page export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createContext.mockResolvedValue({
      session: { user: { id: "u1" } },
      headers: new Headers(),
      db: {},
    });
    mocks.loadPage.mockResolvedValue(page);
    mocks.loadSpace.mockResolvedValue(spaceRow);
    mocks.requirePageCapability.mockResolvedValue({ organizationId: "o1" });
    mocks.assertTwoFactorCompliance.mockResolvedValue(undefined);
    mocks.getStorage.mockReturnValue(null);
  });

  it("rejects unknown formats before touching authenticated data", async () => {
    const response = await pageExportRoutes.request("/pages/p1?format=docx");
    expect(response.status).toBe(400);
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mocks.createContext.mockResolvedValue({ session: null, headers: new Headers(), db: {} });
    const response = await pageExportRoutes.request("/pages/p1?format=pdf");
    expect(response.status).toBe(401);
  });

  it("returns a direct, private PDF — no ZIP", async () => {
    const response = await pageExportRoutes.request("/pages/p1?format=pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("notfallhandbuch.pdf");
    expect(isPdf(bytes)).toBe(true);
    expect(pdfPageCount(bytes)).toBe(1);
  });

  it("checks the capability on the page, not on the surrounding Space", async () => {
    mocks.requirePageCapability.mockRejectedValue(new ORPCError("FORBIDDEN"));
    const response = await pageExportRoutes.request("/pages/p1?format=pdf");

    expect(response.status).toBe(403);
    expect(mocks.requirePageCapability).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      page,
      "read",
    );
  });

  it("reports an unknown page as not found", async () => {
    mocks.loadPage.mockRejectedValue(new ORPCError("NOT_FOUND", { message: "Page not found" }));
    const response = await pageExportRoutes.request("/pages/nope?format=pdf");
    expect(response.status).toBe(404);
  });

  it("points internal links at the live app, which is the only target a lone file has", async () => {
    const response = await pageExportRoutes.request("/pages/p1?format=markdown");
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(body).toContain("https://wiki.test/pages/p2");
  });

  it("serves HTML and JSON as downloads rather than rendering them on our origin", async () => {
    for (const format of ["html", "json"]) {
      const response = await pageExportRoutes.request(`/pages/p1?format=${format}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    }
  });

  it("embeds images the caller may read, authorized one attachment at a time", async () => {
    const png = pngFixture(32, 32);
    mocks.call.mockResolvedValue({
      id: "a1",
      storageKey: "spaces/s1/a1.png",
      mimeType: "image/png",
      size: png.length,
    });
    mocks.getStorage.mockReturnValue({
      download: vi.fn().mockResolvedValue({ stream: streamOf(png) }),
    });

    const response = await pageExportRoutes.request("/pages/p1?format=pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(mocks.call).toHaveBeenCalledOnce();
    expect(pdfEmbedsImage(bytes)).toBe(true);
    expect(pdfLinksTo(bytes, "https://wiki.test/pages/p2")).toBe(true);
  });

  it("omits an image the caller may not read instead of failing the export", async () => {
    mocks.call.mockRejectedValue(new ORPCError("FORBIDDEN"));
    const response = await pageExportRoutes.request("/pages/p1?format=pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(pdfEmbedsImage(bytes)).toBe(false);
  });
});
