import { unzipSync } from "fflate";
import { vi } from "vitest";

/** Shared fixtures for the Space and page export route tests. */

export const spaceFixture = {
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

export function pageRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    spaceId: "s1",
    parentId: null,
    title: `Seite ${id}`,
    slug: `seite-${id}`,
    icon: null,
    coverImage: null,
    status: "published",
    visibility: null,
    position: 0,
    isTemplate: false,
    createdBy: "u1",
    lastEditedBy: "u1",
    publishedAt: null,
    archivedAt: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-02T00:00:00Z"),
    textContent: "Inhalt",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Inhalt" }] }],
    },
    ...overrides,
  };
}

export function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

/** A request context whose database answers the export snapshot queries. */
export function exportContext(overrides: { pages?: unknown[]; attachments?: unknown[] } = {}) {
  const query = {
    space: { findFirst: vi.fn().mockResolvedValue(spaceFixture) },
    page: { findMany: vi.fn().mockResolvedValue(overrides.pages ?? []) },
    tag: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { findMany: vi.fn().mockResolvedValue(overrides.attachments ?? []) },
  };
  const select = vi
    .fn()
    .mockImplementationOnce(() => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
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

export function streamOf(bytes: Uint8Array) {
  return () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
}

export async function archiveEntries(response: Response): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

/** Env values the export modules read; mutable so a test can tighten a limit. */
export function exportEnv() {
  return {
    CORS_ORIGIN: "https://wiki.test",
    ATTACHMENT_MAX_MB: 25,
    PDF_EXPORT_MAX_PAGES: 500,
    PDF_EXPORT_PAGE_TIMEOUT_MS: 15000,
    PDF_EXPORT_IMAGE_CACHE_MB: 64,
  };
}
