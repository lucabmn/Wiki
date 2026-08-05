import type { Database } from "@nilovon-wiki/db";
import {
  attachment,
  page,
  pageExternalLink,
  pageTag,
  space as spaceTable,
  tag,
} from "@nilovon-wiki/db/schema/index";
import { and, asc, eq, isNull } from "drizzle-orm";

import {
  contentFileName,
  normalizeDocument,
  safeArchiveName,
  type ExportFormat,
} from "./space-export-format";

/**
 * One consistent read of everything an archive contains. Taken in a repeatable
 * read, read-only transaction so a long export cannot emit a half-old,
 * half-new Space.
 */
export async function loadSpaceSnapshot(db: Database, spaceId: string) {
  return db.transaction(
    async (tx) => {
      const space = await tx.query.space.findFirst({ where: eq(spaceTable.id, spaceId) });
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
        tx.query.tag.findMany({ where: eq(tag.spaceId, space.id), orderBy: [asc(tag.name)] }),
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
}

export type SpaceSnapshot = NonNullable<Awaited<ReturnType<typeof loadSpaceSnapshot>>>;

export type ArchivePaths = {
  pagePaths: Map<string, string>;
  attachmentPaths: Map<string, string>;
};

/** Archive paths are identical across formats apart from the body file name. */
export function buildArchivePaths(snapshot: SpaceSnapshot, format: ExportFormat): ArchivePaths {
  const extension = contentFileName(format);
  return {
    pagePaths: new Map(
      snapshot.pages.map((item) => [
        item.id,
        `pages/${safeArchiveName(item.slug || item.title, "page")}--${safeArchiveName(item.id)}/${extension}`,
      ]),
    ),
    attachmentPaths: new Map(
      snapshot.attachments.map((item) => [
        item.id,
        `attachments/${safeArchiveName(item.id)}/${safeArchiveName(item.fileName, "attachment")}`,
      ]),
    ),
  };
}

export type ExportLimits = { maxPages: number; pageTimeoutMs: number; skippedPageIds: string[] };

export function buildManifest(
  snapshot: SpaceSnapshot,
  format: ExportFormat,
  paths: ArchivePaths,
  limits: ExportLimits | null,
) {
  const { space, pages, tags, assignments, attachments, externalLinks } = snapshot;
  const documents = new Map(
    pages.map((item) => [item.id, normalizeDocument(item.content, item.textContent)]),
  );

  const tagById = new Map(tags.map((item) => [item.id, item]));
  const tagsByPage = groupBy(
    assignments,
    (item) => item.pageId,
    (item) => tagById.get(item.tagId),
  );
  const linksByPage = groupBy(
    externalLinks,
    (item) => item.pageId,
    (item) => item,
  );
  const skipped = new Set(limits?.skippedPageIds ?? []);

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
    path: paths.pagePaths.get(item.id)!,
    tags: (tagsByPage.get(item.id) ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      color: entry.color,
    })),
    externalLinks: (linksByPage.get(item.id) ?? []).map((link) => ({
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
    warnings: [
      ...documents.get(item.id)!.warnings,
      ...(skipped.has(item.id)
        ? [`Nicht gerendert: Obergrenze von ${limits?.maxPages} Seiten pro PDF-Export erreicht.`]
        : []),
    ],
  }));

  const manifest = {
    format: "nilovon-space-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    contentFormat: format,
    ...(limits ? { limits } : {}),
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
      path: paths.attachmentPaths.get(item.id)!,
    })),
  };

  return { manifest, manifestPages, documents };
}

function groupBy<T, V>(
  items: T[],
  keyOf: (item: T) => string,
  valueOf: (item: T) => V | undefined,
): Map<string, V[]> {
  const grouped = new Map<string, V[]>();
  for (const item of items) {
    const value = valueOf(item);
    if (value === undefined) continue;
    grouped.set(keyOf(item), [...(grouped.get(keyOf(item)) ?? []), value]);
  }
  return grouped;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
