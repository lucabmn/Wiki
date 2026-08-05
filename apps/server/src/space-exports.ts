import { Readable } from "node:stream";

import { createContext, type AuthedContext } from "@nilovon-wiki/api/context";
import { requireSpaceCapability } from "@nilovon-wiki/api/lib/authz";
import { getStorage } from "@nilovon-wiki/api/lib/storage";
import { assertTwoFactorCompliance } from "@nilovon-wiki/api/lib/two-factor-policy";
import {
  attachment,
  page,
  pageExternalLink,
  pageTag,
  space as spaceTable,
  tag,
} from "@nilovon-wiki/db/schema/index";
import { ZipArchive } from "archiver";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { Hono } from "hono";

import {
  contentFileName,
  documentToHtml,
  documentToMarkdown,
  type ExportFormat,
  normalizeDocument,
  rewriteDocumentUrls,
  safeArchiveName,
} from "./space-export-format";

const FORMATS = new Set<ExportFormat>(["markdown", "html", "json"]);

export const spaceExportRoutes = new Hono();

spaceExportRoutes.get("/spaces/:id", async (c) => {
  const format = c.req.query("format") as ExportFormat | undefined;
  if (!format || !FORMATS.has(format)) {
    return c.json({ message: "format must be markdown, html, or json" }, 400);
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
  const snapshot = await context.db.transaction(
    async (tx) => {
      const space = await tx.query.space.findFirst({
        where: eq(spaceTable.id, authorizationSpace.id),
      });
      if (!space) return null;
      const [pages, tags, assignments, attachments, externalLinkRows] = await Promise.all([
        // Templates stay in. Everywhere a human browses — the tree, search,
        // backlinks, the dashboard, the digest — they are filtered out, but this
        // is the "Datenexport": the one artifact that promises the space whole.
        // Dropping rows from a backup to keep a listing tidy is how archives
        // quietly lose data, and `manifest.json` flags every page's `isTemplate`
        // so a consumer that wants only the content can filter it itself.
        tx.query.page.findMany({
          // Pages in the trash are omitted: an export is a snapshot of the space
          // as it stands, not of what is pending deletion.
          where: and(eq(page.spaceId, space.id), isNull(page.deletedAt)),
          orderBy: [asc(page.position), asc(page.createdAt)],
        }),
        tx.query.tag.findMany({
          where: eq(tag.spaceId, space.id),
          orderBy: [asc(tag.name)],
        }),
        tx
          .select({ pageId: pageTag.pageId, tagId: pageTag.tagId })
          .from(pageTag)
          .innerJoin(page, eq(page.id, pageTag.pageId))
          .where(and(eq(page.spaceId, space.id), isNull(page.deletedAt))),
        tx.query.attachment.findMany({
          where: eq(attachment.spaceId, space.id),
          orderBy: [asc(attachment.createdAt)],
        }),
        tx
          .select({ externalLink: pageExternalLink })
          .from(pageExternalLink)
          .innerJoin(page, eq(page.id, pageExternalLink.pageId))
          .where(and(eq(page.spaceId, space.id), isNull(page.deletedAt)))
          .orderBy(asc(pageExternalLink.position)),
      ]);
      return {
        space,
        pages,
        tags,
        assignments,
        attachments,
        externalLinks: externalLinkRows.map((row) => row.externalLink),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (!snapshot) return c.json({ message: "Space changed during export" }, 409);
  const { space, pages, tags, assignments, attachments, externalLinks } = snapshot;
  if (space.deletionPendingAt) {
    return c.json({ message: "Space deletion is pending" }, 409);
  }
  if (attachments.some((item) => item.deletionPendingAt)) {
    return c.json({ message: "Attachment deletion is pending" }, 409);
  }

  const extension = contentFileName(format);
  const pagePaths = new Map(
    pages.map((item) => [
      item.id,
      `pages/${safeArchiveName(item.slug || item.title, "page")}--${safeArchiveName(item.id)}/${extension}`,
    ]),
  );
  const attachmentPaths = new Map(
    attachments.map((item) => [
      item.id,
      `attachments/${safeArchiveName(item.id)}/${safeArchiveName(item.fileName, "attachment")}`,
    ]),
  );
  const tagById = new Map(tags.map((item) => [item.id, item]));
  const tagsByPage = new Map<string, Array<{ id: string; name: string; color: string | null }>>();
  for (const assignment of assignments) {
    const item = tagById.get(assignment.tagId);
    if (item)
      tagsByPage.set(assignment.pageId, [...(tagsByPage.get(assignment.pageId) ?? []), item]);
  }
  const externalLinksByPage = new Map<string, typeof externalLinks>();
  for (const item of externalLinks) {
    externalLinksByPage.set(item.pageId, [...(externalLinksByPage.get(item.pageId) ?? []), item]);
  }
  const normalizedDocuments = new Map(
    pages.map((item) => [item.id, normalizeDocument(item.content, item.textContent)]),
  );

  const manifestPages = pages.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    title: item.title,
    slug: item.slug,
    icon: item.icon,
    coverImage: item.coverImage,
    status: item.status,
    visibility: item.visibility,
    position: item.position,
    isTemplate: item.isTemplate,
    createdBy: item.createdBy,
    lastEditedBy: item.lastEditedBy,
    publishedAt: iso(item.publishedAt),
    archivedAt: iso(item.archivedAt),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    textContent: item.textContent,
    path: pagePaths.get(item.id)!,
    tags: tagsByPage.get(item.id) ?? [],
    externalLinks: (externalLinksByPage.get(item.id) ?? []).map((link) => ({
      id: link.id,
      url: link.url,
      title: link.title,
      description: link.description,
      position: link.position,
      createdBy: link.createdBy,
      createdAt: link.createdAt.toISOString(),
      updatedAt: link.updatedAt.toISOString(),
    })),
    attachmentIds: attachments.filter((file) => file.pageId === item.id).map((file) => file.id),
    warnings: normalizedDocuments.get(item.id)!.warnings,
  }));
  const manifest = {
    format: "nilovon-space-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    contentFormat: format,
    space: {
      id: space.id,
      organizationId: space.organizationId,
      slug: space.slug,
      name: space.name,
      description: space.description,
      icon: space.icon,
      color: space.color,
      visibility: space.visibility,
      createdBy: space.createdBy,
      archivedAt: iso(space.archivedAt),
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt.toISOString(),
    },
    tags: tags.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    pages: manifestPages,
    attachments: attachments.map((item) => ({
      id: item.id,
      pageId: item.pageId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      size: item.size,
      checksum: item.checksum,
      uploadedBy: item.uploadedBy,
      isDraft: item.isDraft,
      createdAt: item.createdAt.toISOString(),
      path: attachmentPaths.get(item.id)!,
    })),
  };

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
  for (const item of pages) {
    const ownPath = pagePaths.get(item.id)!;
    const resolveUrl = (url: string) => resolveArchiveUrl(url, pagePaths, attachmentPaths);
    const content = rewriteDocumentUrls(normalizedDocuments.get(item.id)!.content, resolveUrl);
    if (format === "markdown") {
      archive.append(documentToMarkdown(content, item.title), { name: ownPath });
    } else if (format === "html") {
      archive.append(documentToHtml(content, item.title), { name: ownPath });
    } else {
      archive.append(
        `${JSON.stringify({ page: manifestByPage.get(item.id), content }, null, 2)}\n`,
        { name: ownPath },
      );
    }
  }

  if (attachments.length) {
    const storage = getStorage();
    if (!storage) return c.json({ message: "Attachments are disabled" }, 501);
    for (const item of attachments) {
      const stream = Readable.from(
        (async function* () {
          const stored = await storage.download(item.storageKey, { as: "stream" });
          let bytes = 0;
          for await (const chunk of Readable.fromWeb(stored.stream())) {
            bytes += chunk.length;
            yield chunk;
          }
          if (bytes !== item.size) {
            throw new Error(`Attachment ${item.id} size mismatch`);
          }
        })(),
      );
      attachmentStreams.push(stream);
      stream.on("error", (error) => archive.destroy(error));
      archive.append(stream, { name: attachmentPaths.get(item.id)! });
    }
  }

  void archive.finalize().catch((error) => archive.destroy(error));
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

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function resolveArchiveUrl(
  url: string,
  pagePaths: Map<string, string>,
  attachmentPaths: Map<string, string>,
): string {
  const attachmentMatch = /^\/attachments\/([^/?#]+)\/(?:inline|download)(?:[?#].*)?$/.exec(url);
  const attachmentId = attachmentMatch?.[1] ? safeDecodeURIComponent(attachmentMatch[1]) : null;
  const attachmentPath = attachmentId ? attachmentPaths.get(attachmentId) : null;
  if (attachmentPath) return `../../${attachmentPath}`;

  const pageMatch = /^\/pages\/([^/?#]+)([?#].*)?$/.exec(url);
  const pageId = pageMatch?.[1] ? safeDecodeURIComponent(pageMatch[1]) : null;
  const pagePath = pageId ? pagePaths.get(pageId) : null;
  if (pagePath) return `../${pagePath.slice("pages/".length)}${pageMatch?.[2] ?? ""}`;
  return safePortableUrl(url);
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function safePortableUrl(url: string): string {
  const value = url.trim();
  if (!value) return "#";
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return "#";
  if (
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  )
    return "#";
  return value;
}

const ARCHIVE_FORMAT_README = `# Space Export v1

This archive is self-contained and uses the documented \`nilovon-space-export\` format.
See \`manifest.json\` for space metadata, page hierarchy, tags, attachment metadata and paths.
Page bodies live below \`pages/\` in the selected content format. Attachment bytes live below
\`attachments/\`; links to known pages and attachments are rewritten to relative paths.

The canonical specification is in \`docs/export-format.md\` in the Wiki repository.
`;
