import { Readable } from "node:stream";

import { createContext, type AuthedContext } from "@nilovon-wiki/api/context";
import { requireSpaceCapability } from "@nilovon-wiki/api/lib/authz";
import { getStorage } from "@nilovon-wiki/api/lib/storage";
import { assertTwoFactorCompliance } from "@nilovon-wiki/api/lib/two-factor-policy";
import { space as spaceTable } from "@nilovon-wiki/db/schema/index";
import { ZipArchive } from "archiver";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { Hono } from "hono";

import { buildExportReport, pdfExportLimits, renderPagePdf, type ReportEntry } from "./export-pdf";
import { resolveArchiveUrl } from "./export-urls";
import { placeholderPdf } from "./pdf/document-to-pdf";
import { createImageLoader } from "./pdf/pdf-images";
import {
  documentToHtml,
  type ExportFormat,
  rewriteDocumentUrls,
  safeArchiveName,
} from "./space-export-format";
import { documentToMarkdown } from "./space-export-markdown";
import {
  buildArchivePaths,
  buildManifest,
  loadSpaceSnapshot,
  type SpaceSnapshot,
} from "./space-export-snapshot";

const FORMATS = new Set<ExportFormat>(["markdown", "html", "json", "pdf"]);

export { resolveArchiveUrl };

export const spaceExportRoutes = new Hono();

spaceExportRoutes.get("/spaces/:id", async (c) => {
  const format = c.req.query("format") as ExportFormat | undefined;
  if (!format || !FORMATS.has(format)) {
    return c.json({ message: "format must be markdown, html, json, or pdf" }, 400);
  }

  const context = await createContext({ context: c });
  if (!context.session?.user) return c.json({ message: "Unauthorized" }, 401);
  const authedContext = context as AuthedContext;
  const authorizationSpace = await context.db.query.space.findFirst({
    where: eq(spaceTable.id, c.req.param("id")),
  });
  // A trashed space behaves as missing everywhere, exports included — otherwise
  // "deleted" would still be one URL away from a full archive of its contents.
  if (!authorizationSpace || authorizationSpace.deletedAt) {
    return c.json({ message: "Space not found" }, 404);
  }

  try {
    // A Space export is the single largest read in the product, and it never
    // passes through oRPC — so the two-factor policy has to be asked here
    // explicitly or it would be trivially sidestepped.
    await assertTwoFactorCompliance(context.db, context.session);
    await requireSpaceCapability(
      context.db,
      authedContext,
      context.headers,
      authorizationSpace,
      "manage",
    );
  } catch (error) {
    if (error instanceof ORPCError) {
      return c.json({ message: error.message }, error.status === 403 ? 403 : 500);
    }
    throw error;
  }

  const snapshot = await loadSpaceSnapshot(context.db, authorizationSpace.id);
  if (!snapshot) return c.json({ message: "Space changed during export" }, 409);
  const { space, pages, attachments } = snapshot;
  if (space.deletionPendingAt) return c.json({ message: "Space deletion is pending" }, 409);
  if (attachments.some((item) => item.deletionPendingAt)) {
    return c.json({ message: "Attachment deletion is pending" }, 409);
  }

  const storage = getStorage();
  if (attachments.length && !storage) return c.json({ message: "Attachments are disabled" }, 501);

  const limits = format === "pdf" ? pdfExportLimits() : null;
  const paths = buildArchivePaths(snapshot, format);
  const { manifest, manifestPages, documents } = buildManifest(
    snapshot,
    format,
    paths,
    limits
      ? {
          maxPages: limits.maxPages,
          pageTimeoutMs: limits.pageTimeoutMs,
          skippedPageIds: pages.slice(limits.maxPages).map((item) => item.id),
        }
      : null,
  );

  const archive = new ZipArchive({ zlib: { level: 6 }, forceZip64: true });
  const attachmentStreams: Readable[] = [];
  archive.on("close", () => {
    for (const stream of attachmentStreams) {
      if (!stream.destroyed) stream.destroy();
    }
  });
  archive.on("warning", (error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") archive.destroy(error);
  });
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "manifest.json" });
  archive.append(ARCHIVE_FORMAT_README, { name: "FORMAT.md" });

  const manifestByPage = new Map(manifestPages.map((item) => [item.id, item]));
  const resolveUrl = (url: string) =>
    resolveArchiveUrl(url, paths.pagePaths, paths.attachmentPaths);
  const loadImage = limits
    ? createImageLoader({
        storage,
        resolve: async (id) => attachments.find((item) => item.id === id) ?? null,
        maxBytes: limits.maxImageBytes,
        cacheBytes: limits.cacheBytes,
      })
    : undefined;

  // Pages are rendered strictly one at a time inside the streaming archive: the
  // client sees bytes immediately, and peak memory stays at one page's worth
  // rather than the whole Space's.
  void (async () => {
    try {
      const report: ReportEntry[] = [];
      let overLimit: Buffer | null = null;
      for (const [index, item] of pages.entries()) {
        if (c.req.raw.signal?.aborted) throw new Error("Export aborted by the client");
        const name = paths.pagePaths.get(item.id)!;
        const content = documents.get(item.id)!.content;

        if (!limits) {
          archive.append(
            body(format, rewriteDocumentUrls(content, resolveUrl), item.title, {
              page: manifestByPage.get(item.id),
            }),
            { name },
          );
          continue;
        }

        const meta = {
          title: item.title,
          spaceName: space.name,
          exportedAt: new Date(),
          breadcrumb: ancestorTitles(snapshot, item.parentId),
        };
        if (index >= limits.maxPages) {
          const detail = `Obergrenze von ${limits.maxPages} Seiten pro Export erreicht.`;
          overLimit ??= await placeholderPdf(meta, `Diese Seite wurde nicht exportiert. ${detail}`);
          archive.append(overLimit, { name });
          report.push({ title: item.title, path: name, outcome: "skipped", detail });
          continue;
        }
        const rendered = await renderPagePdf(content, meta, {
          loadImage,
          resolveLink: resolveUrl,
          timeoutMs: limits.pageTimeoutMs,
        });
        archive.append(rendered.bytes, { name });
        if (rendered.outcome !== "rendered") {
          report.push({
            title: item.title,
            path: name,
            outcome: rendered.outcome,
            detail: rendered.detail ?? "",
          });
        }
      }
      if (limits && report.length) {
        archive.append(buildExportReport(report, limits), { name: "EXPORT-REPORT.md" });
      }

      for (const item of attachments) {
        const stream = Readable.from(
          (async function* () {
            const stored = await storage!.download(item.storageKey, { as: "stream" });
            let bytes = 0;
            for await (const chunk of Readable.fromWeb(stored.stream())) {
              bytes += chunk.length;
              yield chunk;
            }
            if (bytes !== item.size) throw new Error(`Attachment ${item.id} size mismatch`);
          })(),
        );
        attachmentStreams.push(stream);
        stream.on("error", (error) => archive.destroy(error));
        archive.append(stream, { name: paths.attachmentPaths.get(item.id)! });
      }
      await archive.finalize();
    } catch (error) {
      archive.destroy(error as Error);
    }
  })();

  const archiveName = `${safeArchiveName(space.slug || space.name, "space")}-${format}-export.zip`;
  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

function body(
  format: ExportFormat,
  content: unknown,
  title: string,
  extras: Record<string, unknown>,
): string {
  if (format === "markdown") return documentToMarkdown(content, title);
  if (format === "html") return documentToHtml(content, title);
  return `${JSON.stringify({ ...extras, content }, null, 2)}\n`;
}

/** Ancestor titles, root first — the breadcrumb printed under a page's title. */
function ancestorTitles(snapshot: SpaceSnapshot, parentId: string | null): string[] {
  const byId = new Map(snapshot.pages.map((item) => [item.id, item]));
  const trail: string[] = [];
  let current = parentId;
  for (let depth = 0; current && depth < 32; depth++) {
    const parent = byId.get(current);
    if (!parent) break;
    trail.unshift(parent.title);
    current = parent.parentId;
  }
  return trail;
}

const ARCHIVE_FORMAT_README = `# Space Export v1

This archive is self-contained and uses the documented \`nilovon-space-export\` format.
See \`manifest.json\` for space metadata, page hierarchy, tags, attachment metadata and paths.
Page bodies live below \`pages/\` in the selected content format. Attachment bytes live below
\`attachments/\`; links to known pages and attachments are rewritten to relative paths.

PDF exports embed their images, so \`content.pdf\` is readable on its own. If any page hit the
configured ceilings, \`EXPORT-REPORT.md\` lists it — the archive is never silently truncated.

The canonical specification is in \`docs/export-format.md\` in the Wiki repository.
`;
