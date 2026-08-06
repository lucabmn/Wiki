import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  adoptMermaidCodeBlocks,
  MERMAID_CAPTION_LIMIT,
  MERMAID_NODE_NAME,
  MERMAID_SOURCE_LIMIT,
} from "@nilovon-wiki/editor/mermaid-document";
import { attachment, page, pageRevision } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { isOrgManager, protectedProcedure } from "../index";
import { filterReadablePages, loadSpaceRole } from "../lib/access";
import { requirePageCapability, requireSpaceCapabilityById } from "../lib/authz";
import { activityActor, recordActivity } from "../lib/activity";
import { COLLAB_TOKEN_TTL_SECONDS, collabDocName, signCollabToken } from "../lib/collab-token";
import { generateKeyBetween } from "../lib/fractional";
import { pageNotTrashed } from "../lib/lifecycle";
import { loadPage, loadSpace } from "../lib/loaders";
import { announcePageMentions } from "../lib/notifications/sources";
import { extractPageLinks, syncPageLinks } from "../lib/page-links";
import {
  assertNoCycle,
  assertParentInSpace,
  positionAtEnd,
  positionForMove,
  siblingsOf,
} from "../lib/page-tree";
import { assertPageDeletable, pageSubtreeIds } from "../lib/retention/holds";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CreatePageInputSchema,
  FinalizeImportAssetsInputSchema,
  FinalizeImportAssetsResultSchema,
  ImportPagesInputSchema,
  ImportPagesResultSchema,
  ListPagesInputSchema,
  MovePageInputSchema,
  PageRevisionSchema,
  PageSchema,
  PageTreeInputSchema,
  PageTreeNodeSchema,
  PublishPageInputSchema,
  UpdatePageInputSchema,
} from "../schemas/page";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Pages"];

const IMPORT_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "image",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  MERMAID_NODE_NAME,
]);
const IMPORT_MARK_TYPES = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "highlight",
  "subscript",
  "superscript",
]);

function assertImportKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ORPCError("BAD_REQUEST", { message });
  }
}

function importAttrs(node: Record<string, unknown>): Record<string, unknown> | undefined {
  if (node.attrs === undefined) return undefined;
  if (!node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs)) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid imported attributes" });
  }
  return node.attrs as Record<string, unknown>;
}

function assertSafeImportNodeAttrs(node: Record<string, unknown>): void {
  const attrs = importAttrs(node);
  if (!attrs) return;
  switch (node.type) {
    case "image": {
      assertImportKeys(attrs, ["src", "alt", "title"], "Unsupported image attribute");
      if (
        typeof attrs.src !== "string" ||
        !attrs.src.startsWith("migration-asset:") ||
        (attrs.alt !== undefined && attrs.alt !== null && typeof attrs.alt !== "string") ||
        (attrs.title !== undefined && attrs.title !== null && typeof attrs.title !== "string")
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Imported image attributes are invalid" });
      }
      return;
    }
    case "heading":
      assertImportKeys(attrs, ["level"], "Unsupported heading attribute");
      if (!Number.isInteger(attrs.level) || Number(attrs.level) < 1 || Number(attrs.level) > 6) {
        throw new ORPCError("BAD_REQUEST", { message: "Imported heading level is invalid" });
      }
      return;
    case "orderedList":
      assertImportKeys(attrs, ["start", "type"], "Unsupported ordered-list attribute");
      if (!Number.isInteger(attrs.start) || Number(attrs.start) < 1 || attrs.type !== null) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Imported ordered-list attributes are invalid",
        });
      }
      return;
    case MERMAID_NODE_NAME:
      assertImportKeys(attrs, ["source", "caption"], "Unsupported diagram attribute");
      if (
        typeof attrs.source !== "string" ||
        attrs.source.length > MERMAID_SOURCE_LIMIT ||
        (attrs.caption !== null &&
          attrs.caption !== undefined &&
          (typeof attrs.caption !== "string" || attrs.caption.length > MERMAID_CAPTION_LIMIT))
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Imported diagram attributes are invalid" });
      }
      return;
    case "codeBlock":
      assertImportKeys(attrs, ["language"], "Unsupported code-block attribute");
      if (
        attrs.language !== null &&
        (typeof attrs.language !== "string" || !/^[A-Za-z0-9_+-]{1,40}$/.test(attrs.language))
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Imported code language is invalid" });
      }
      return;
    case "tableCell":
    case "tableHeader":
      assertImportKeys(attrs, ["colspan", "rowspan", "colwidth"], "Unsupported table attribute");
      if (
        !Number.isInteger(attrs.colspan) ||
        Number(attrs.colspan) < 1 ||
        Number(attrs.colspan) > 100 ||
        !Number.isInteger(attrs.rowspan) ||
        Number(attrs.rowspan) < 1 ||
        Number(attrs.rowspan) > 100 ||
        attrs.colwidth !== null
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Imported table attributes are invalid" });
      }
      return;
    default:
      if (Object.keys(attrs).length) {
        throw new ORPCError("BAD_REQUEST", { message: "Unsupported imported node attributes" });
      }
  }
}

/** Imported JSON never contains raw HTML or unchecked style-bearing attributes. */
function assertSafeImportDocument(value: unknown): void {
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 100 || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid imported document" });
    }
    const node = candidate as Record<string, unknown>;
    if (typeof node.type !== "string" || !IMPORT_NODE_TYPES.has(node.type)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Unsupported imported node: ${String(node.type)}`,
      });
    }
    assertImportKeys(node, ["type", "text", "attrs", "marks", "content"], "Invalid node field");
    assertSafeImportNodeAttrs(node);
    if (node.type === "text" && typeof node.text !== "string") {
      throw new ORPCError("BAD_REQUEST", { message: "Imported text node is invalid" });
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks))
        throw new ORPCError("BAD_REQUEST", { message: "Invalid marks" });
      for (const candidateMark of node.marks) {
        if (!candidateMark || typeof candidateMark !== "object") {
          throw new ORPCError("BAD_REQUEST", { message: "Invalid mark" });
        }
        const mark = candidateMark as Record<string, unknown>;
        assertImportKeys(mark, ["type", "attrs"], "Invalid imported mark field");
        if (typeof mark.type !== "string" || !IMPORT_MARK_TYPES.has(mark.type)) {
          throw new ORPCError("BAD_REQUEST", { message: "Unsupported imported mark" });
        }
        const attrs = importAttrs(mark);
        if (mark.type === "link") {
          if (!attrs) throw new ORPCError("BAD_REQUEST", { message: "Imported link has no URL" });
          assertImportKeys(attrs, ["href"], "Unsupported link attribute");
          const href = attrs.href;
          if (typeof href !== "string" || !/^(https?:|mailto:|\/|#|migration-asset:)/i.test(href)) {
            throw new ORPCError("BAD_REQUEST", { message: "Imported link has an unsafe URL" });
          }
        } else if (mark.type === "highlight") {
          if (attrs) {
            assertImportKeys(attrs, ["color"], "Unsupported highlight attribute");
            if (attrs.color !== null && !/^#[0-9a-f]{3,8}$/i.test(String(attrs.color))) {
              throw new ORPCError("BAD_REQUEST", {
                message: "Imported highlight color is invalid",
              });
            }
          }
        } else if (attrs && Object.keys(attrs).length) {
          throw new ORPCError("BAD_REQUEST", { message: "Unsupported imported mark attributes" });
        }
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid imported document content" });
      }
      for (const child of node.content) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function attachmentIdsInDocument(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const object = candidate as Record<string, unknown>;
    const attrs = object.attrs;
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      for (const key of ["src", "href"] as const) {
        const value = (attrs as Record<string, unknown>)[key];
        if (typeof value !== "string") continue;
        const match = /\/attachments\/([^/]+)\/(?:inline|download)(?:[?#]|$)/.exec(value);
        if (match?.[1]) ids.add(match[1]);
      }
    }
    visit(object.content);
    visit(object.marks);
  };
  visit(value);
  return [...ids];
}

function redactDraftBody<
  T extends { status: string; publishedAt: Date | null; content: unknown; textContent: string },
>(row: T): T {
  // Archiving changes status, so publishedAt is the durable signal that a body
  // has ever crossed the publication boundary.
  return row.status === "draft" || row.publishedAt === null
    ? { ...row, content: null, textContent: "" }
    : row;
}

function replaceImportAssetUrls(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceImportAssetUrls(item, replacements));
  }
  if (!value || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...object };
  if (object.attrs && typeof object.attrs === "object" && !Array.isArray(object.attrs)) {
    const attrs = { ...(object.attrs as Record<string, unknown>) };
    if (typeof attrs.src === "string" && replacements.has(attrs.src)) {
      attrs.src = replacements.get(attrs.src)!;
    }
    if (typeof attrs.href === "string" && replacements.has(attrs.href)) {
      attrs.href = replacements.get(attrs.href)!;
    }
    next.attrs = attrs;
  }
  if (Array.isArray(object.content)) {
    next.content = object.content.map((item) => replaceImportAssetUrls(item, replacements));
  }
  if (Array.isArray(object.marks)) {
    next.marks = object.marks.map((item) => replaceImportAssetUrls(item, replacements));
  }
  return next;
}

export const pageRouter = {
  /**
   * The space's page tree, as ids and titles.
   *
   * Separate from `list` because the sidebar and the breadcrumb were driving
   * the full page list — which carries every page's document body. On a large
   * wiki that is tens of megabytes serialized on every navigation, to render a
   * list of titles. This selects the eight columns the tree actually reads.
   *
   * Access is filtered exactly as in `list`: same space role, same per-page
   * override check. `createdBy` and `visibility` are selected only to feed that
   * filter and are dropped before the response — a tree node is a label, not a
   * place to leak who may see what.
   */
  tree: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces/{spaceId}/tree",
      tags: TAGS,
      summary: "List a space's pages as tree nodes (no page bodies)",
    })
    .input(PageTreeInputSchema)
    .output(z.array(PageTreeNodeSchema))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const spaceRole = await loadSpaceRole(context.db, context, spaceRow, manager);
      if (spaceRole === null) throw new ORPCError("FORBIDDEN");

      const rows = await context.db
        .select({
          id: page.id,
          parentId: page.parentId,
          title: page.title,
          slug: page.slug,
          icon: page.icon,
          status: page.status,
          position: page.position,
          archivedAt: page.archivedAt,
          // For `filterReadablePages` only — see the note above.
          visibility: page.visibility,
          createdBy: page.createdBy,
        })
        .from(page)
        .where(
          and(
            eq(page.spaceId, input.spaceId),
            input.includeArchived ? undefined : isNull(page.archivedAt),
            // Templates belong to the template catalogue, not to the tree.
            eq(page.isTemplate, false),
            pageNotTrashed(),
          ),
        )
        .orderBy(asc(page.position));

      const readable = await filterReadablePages(context.db, context, rows, spaceRole);
      return readable.map(({ visibility: _visibility, createdBy: _createdBy, ...node }) => node);
    }),

  list: protectedProcedure
    .route({ method: "GET", path: "/pages", tags: TAGS, summary: "List pages in a space" })
    .input(ListPagesInputSchema)
    .output(z.array(PageSchema))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const spaceRole = await loadSpaceRole(context.db, context, spaceRow, manager);
      if (spaceRole === null) throw new ORPCError("FORBIDDEN");
      const rows = await context.db.query.page.findMany({
        where: and(
          eq(page.spaceId, input.spaceId),
          input.parentId === undefined
            ? undefined
            : input.parentId === null
              ? isNull(page.parentId)
              : eq(page.parentId, input.parentId),
          input.status ? eq(page.status, input.status) : undefined,
          input.includeArchived ? undefined : isNull(page.archivedAt),
          // A template is not a page of the wiki — it belongs to the template
          // catalogue (`pages.listTemplates`), not to the space's tree.
          input.includeTemplates ? undefined : eq(page.isTemplate, false),
          // Trashed pages are never listed here, not even with
          // `includeArchived`: the trash has its own view, and the two states
          // are different questions ("still findable?" vs "already gone?").
          pageNotTrashed(),
        ),
        orderBy: [asc(page.position)],
      });
      // Drop pages restricted by a per-page override the caller can't read.
      // Draft bodies live in the working copy and never cross reader APIs.
      const readable = await filterReadablePages(context.db, context, rows, spaceRole);
      return readable.map(redactDraftBody);
    }),

  get: protectedProcedure
    .route({ method: "GET", path: "/pages/{id}", tags: TAGS, summary: "Get a page" })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const row = await loadPage(context.db, input.id);
      await requirePageCapability(context.db, context, context.headers, row, "read");
      return redactDraftBody(row);
    }),

  import: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/import",
      tags: TAGS,
      summary: "Import a batch of HTML-converted pages",
    })
    .input(ImportPagesInputSchema)
    .output(ImportPagesResultSchema)
    .handler(async ({ input, context }) => {
      const { organizationId } = await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        input.spaceId,
        "write",
      );
      const rootParentId = input.parentId ?? null;
      await assertParentInSpace(context.db, rootParentId, input.spaceId);

      const byKey = new Map(input.pages.map((item) => [item.key, item]));
      if (byKey.size !== input.pages.length) {
        throw new ORPCError("BAD_REQUEST", { message: "Import page keys must be unique" });
      }
      for (const item of input.pages) {
        // ` ```mermaid ` fences arrive as code blocks from every Markdown-ish
        // source; turning them into diagram nodes here closes the export/import
        // round trip no matter which client did the conversion.
        item.content = adoptMermaidCodeBlocks(item.content);
        assertSafeImportDocument(item.content);
        if (
          input.status === "published" &&
          JSON.stringify(item.content).includes("migration-asset:")
        ) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Pages with migration assets must be finalized before publishing",
          });
        }
        if (item.parentKey && !byKey.has(item.parentKey)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Missing imported parent for ${item.title}`,
          });
        }
      }

      // Topological order makes parent ids available before children and detects cycles.
      const ordered: typeof input.pages = [];
      const remaining = new Map(byKey);
      while (remaining.size) {
        const ready = [...remaining.values()].filter(
          (item) => !item.parentKey || !remaining.has(item.parentKey),
        );
        if (!ready.length) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Imported page hierarchy contains a cycle",
          });
        }
        for (const item of ready) {
          ordered.push(item);
          remaining.delete(item.key);
        }
      }

      const userId = context.session.user.id;
      const reservedSlugs = new Set<string>();
      const resolvedSlugs = new Map<string, string>();
      for (const item of ordered) {
        const slug = await uniqueSlug(slugify(item.title), async (candidate) => {
          if (reservedSlugs.has(candidate)) return true;
          return !!(await context.db.query.page.findFirst({
            where: and(eq(page.spaceId, input.spaceId), eq(page.slug, candidate)),
            columns: { id: true },
          }));
        });
        reservedSlugs.add(slug);
        resolvedSlugs.set(item.key, slug);
      }

      const existingRootPosition = await context.db.query.page.findFirst({
        where: siblingsOf(input.spaceId, rootParentId),
        orderBy: [desc(page.position)],
        columns: { position: true },
      });

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const ids = new Map<string, string>();
            const lastPosition = new Map<string, string | null>([
              [rootParentId ?? "__root__", existingRootPosition?.position ?? null],
            ]);
            const imported: Array<{
              key: string;
              id: string;
              title: string;
              slug: string;
              status: "draft" | "published";
            }> = [];

            for (const item of ordered) {
              const parentId = item.parentKey ? ids.get(item.parentKey)! : rootParentId;
              const positionKey = parentId ?? "__root__";
              const position = generateKeyBetween(lastPosition.get(positionKey) ?? null, null);
              lastPosition.set(positionKey, position);
              const publishedAt = input.status === "published" ? new Date() : null;
              const rows = await tx
                .insert(page)
                .values({
                  spaceId: input.spaceId,
                  parentId,
                  title: item.title,
                  slug: resolvedSlugs.get(item.key)!,
                  content: item.content,
                  textContent: item.textContent,
                  status: input.status,
                  position,
                  publishedAt,
                  createdBy: userId,
                  lastEditedBy: userId,
                })
                .returning();
              const row = firstRow(rows);
              ids.set(item.key, row.id);
              if (input.status === "published") {
                await tx.insert(pageRevision).values({
                  pageId: row.id,
                  version: 1,
                  title: row.title,
                  content: row.content,
                  textContent: row.textContent,
                  summary: `Importiert aus ${item.sourcePath}`,
                  editedBy: userId,
                });
                await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(row.content));
              }
              await recordActivity(tx, {
                organizationId,
                action: "page.created",
                ...activityActor(context),
                spaceId: row.spaceId,
                pageId: row.id,
                metadata: { title: row.title, source: "html-import", sourcePath: item.sourcePath },
              });
              imported.push({
                key: item.key,
                id: row.id,
                title: row.title,
                slug: row.slug,
                status: input.status,
              });
            }
            return { imported };
          }),
        "A page with one of the imported slugs already exists",
      );
    }),

  finalizeImportAssets: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/import/assets",
      tags: TAGS,
      summary: "Replace migration asset placeholders with uploaded attachments",
    })
    .input(FinalizeImportAssetsInputSchema)
    .output(FinalizeImportAssetsResultSchema)
    .handler(async ({ input, context }) => {
      const prepared: Array<{
        row: Awaited<ReturnType<typeof loadPage>>;
        organizationId: string;
        replacements: Map<string, string>;
      }> = [];
      const baseUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");

      for (const item of input.pages) {
        const row = await loadPage(context.db, item.id);
        const { organizationId } = await requirePageCapability(
          context.db,
          context,
          context.headers,
          row,
          "write",
        );
        if (row.status !== "draft") {
          throw new ORPCError("CONFLICT", {
            message: "Only unpublished imported pages can have assets finalized.",
          });
        }
        if (row.yjsState) {
          throw new ORPCError("CONFLICT", {
            message:
              "This imported page was already opened for editing; assets can no longer be finalized safely.",
          });
        }
        const replacements = new Map<string, string>();
        for (const asset of item.assets) {
          if (!asset.placeholder.startsWith("migration-asset:")) {
            throw new ORPCError("BAD_REQUEST", { message: "Invalid migration asset placeholder" });
          }
          const stored = await context.db.query.attachment.findFirst({
            where: eq(attachment.id, asset.attachmentId),
            columns: { id: true, pageId: true, mimeType: true },
          });
          if (!stored || stored.pageId !== row.id) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Imported attachment does not belong to the target page",
            });
          }
          const endpoint = /^(image\/(png|jpeg|gif|webp|avif|bmp))$/i.test(stored.mimeType)
            ? "inline"
            : "download";
          replacements.set(asset.placeholder, `${baseUrl}/attachments/${stored.id}/${endpoint}`);
        }
        prepared.push({ row, organizationId, replacements });
      }

      await context.db.transaction(async (tx) => {
        for (const item of prepared) {
          const content = replaceImportAssetUrls(item.row.content, item.replacements);
          const updated = await tx
            .update(page)
            .set({ content, lastEditedBy: context.session.user.id })
            .where(and(eq(page.id, item.row.id), isNull(page.yjsState), eq(page.status, "draft")))
            .returning({ id: page.id });
          if (!updated.length) {
            throw new ORPCError("CONFLICT", {
              message: "The imported page changed while its assets were being finalized.",
            });
          }
          await recordActivity(tx, {
            organizationId: item.organizationId,
            action: "page.updated",
            ...activityActor(context),
            spaceId: item.row.spaceId,
            pageId: item.row.id,
            metadata: { title: item.row.title, source: "html-import-assets" },
          });
        }
      });

      return { finalizedPageIds: prepared.map((item) => item.row.id) };
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/pages", tags: TAGS, summary: "Create a page" })
    .input(CreatePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const { organizationId } = await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        input.spaceId,
        "write",
      );

      const parentId = input.parentId ?? null;
      await assertParentInSpace(context.db, parentId, input.spaceId);
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.title),
        async (candidate) =>
          !!(await context.db.query.page.findFirst({
            where: and(eq(page.spaceId, input.spaceId), eq(page.slug, candidate)),
          })),
      );
      const position = await positionAtEnd(context.db, input.spaceId, parentId);
      const userId = context.session.user.id;

      // uniqueSlug pre-checks, but two concurrent creates can both pass it and
      // then collide on `page_space_slug_uq`; map that race to a 409, not a 500.
      const created = await mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const rows = await tx
              .insert(page)
              .values({
                spaceId: input.spaceId,
                parentId,
                title: input.title,
                slug,
                icon: input.icon ?? null,
                coverImage: input.coverImage ?? null,
                content: input.content ?? null,
                textContent: input.textContent,
                isTemplate: input.isTemplate,
                position,
                createdBy: userId,
                lastEditedBy: userId,
              })
              .returning();
            const row = firstRow(rows);
            if (input.content !== undefined) {
              await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(input.content));
            }
            await recordActivity(tx, {
              organizationId,
              action: "page.created",
              ...activityActor(context),
              spaceId: row.spaceId,
              pageId: row.id,
              metadata: { title: row.title },
            });
            return row;
          }),
        "A page with this slug already exists in the space",
      );
      await announcePageMentions(context.db, {
        organizationId,
        page: created,
        content: input.content ?? null,
        actorId: userId,
      });
      return created;
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/pages/{id}", tags: TAGS, summary: "Update a page" })
    .input(UpdatePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      const { id, ...patch } = input;
      // A caller-supplied slug is de-duplicated within the space (excluding this
      // page) so it can't collide on `page_space_slug_uq` and surface as a 500.
      if (patch.slug !== undefined) {
        patch.slug = await uniqueSlug(
          patch.slug,
          async (candidate) =>
            !!(await context.db.query.page.findFirst({
              where: and(
                eq(page.spaceId, existing.spaceId),
                eq(page.slug, candidate),
                sql`${page.id} <> ${id}`,
              ),
            })),
        );
      }
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ ...patch, lastEditedBy: context.session.user.id })
          .where(eq(page.id, id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.updated",
          ...activityActor(context),
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  publish: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/publish",
      tags: TAGS,
      summary: "Publish a page: promote the working copy and snapshot a revision",
    })
    .input(PublishPageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      const userId = context.session.user.id;
      // Promote the caller's current working copy into the published projection.
      // Collab only persists the working draft as `yjsState`, so publish is the
      // single point where `content`/`textContent` (and thus the read view,
      // search, and backlinks) advance. Absent input falls back to the last
      // published state, making an API-only re-publish a safe no-content op.
      const nextTitle = input.title?.trim() || existing.title;
      const nextContent = input.content !== undefined ? input.content : existing.content;
      const nextText = input.textContent !== undefined ? input.textContent : existing.textContent;
      const published = await context.db.transaction(async (tx) => {
        const latest = await tx.query.pageRevision.findFirst({
          where: eq(pageRevision.pageId, existing.id),
          orderBy: [desc(pageRevision.version)],
          columns: { version: true },
        });
        await tx.insert(pageRevision).values({
          pageId: existing.id,
          version: (latest?.version ?? 0) + 1,
          title: nextTitle,
          content: nextContent,
          textContent: nextText,
          summary: input.summary ?? null,
          editedBy: userId,
        });
        const rows = await tx
          .update(page)
          .set({
            title: nextTitle,
            content: nextContent,
            textContent: nextText,
            status: "published",
            publishedAt: new Date(),
            lastEditedBy: userId,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        // Promote queued sidebar attachments and only editor/import assets that
        // the published document actually references. Removed draft images stay
        // private instead of becoming enumerable merely because Publish ran.
        const referencedAttachmentIds = attachmentIdsInDocument(nextContent);
        await tx
          .update(attachment)
          .set({ isDraft: false, publishOnNextPublish: false })
          .where(
            and(
              eq(attachment.pageId, row.id),
              eq(attachment.isDraft, true),
              or(
                eq(attachment.publishOnNextPublish, true),
                referencedAttachmentIds.length
                  ? inArray(attachment.id, referencedAttachmentIds)
                  : undefined,
              ),
            ),
          );
        // Backlinks reflect published content only — resynced here, never by the
        // collab store.
        await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(nextContent));
        await recordActivity(tx, {
          organizationId,
          action: "page.published",
          ...activityActor(context),
          spaceId: existing.spaceId,
          pageId: existing.id,
          metadata: { title: nextTitle },
        });
        return row;
      });
      // Publish is where a page body becomes readable content — the collab
      // server only ever persists the Yjs snapshot — so it is also the point
      // where a mention written in the editor takes effect.
      await announcePageMentions(context.db, {
        organizationId,
        page: published,
        content: nextContent,
        actorId: userId,
      });
      return published;
    }),

  move: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/move",
      tags: TAGS,
      summary: "Move or reorder a page within its space",
    })
    .input(MovePageInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      const parentId = input.parentId === undefined ? existing.parentId : input.parentId;
      await assertParentInSpace(context.db, parentId, existing.spaceId);
      await assertNoCycle(context.db, existing.id, parentId);
      const position = await positionForMove(
        context.db,
        existing.spaceId,
        parentId,
        existing.id,
        input.beforeId,
        input.afterId,
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ parentId, position, lastEditedBy: context.session.user.id })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.moved",
          ...activityActor(context),
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  archive: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/archive",
      tags: TAGS,
      summary: "Soft-archive a page",
    })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({
            status: "archived",
            archivedAt: new Date(),
            lastEditedBy: context.session.user.id,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.archived",
          ...activityActor(context),
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  /**
   * Soft delete: the page moves to the trash and disappears from every view, but
   * stays restorable until the org's trash window expires. Archiving is *not*
   * the same thing and neither replaces the other — archived means "no longer
   * current, still findable", deleted means "gone, recoverable for now".
   */
  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{id}",
      tags: TAGS,
      summary: "Move a page (and its subtree) to the trash",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema, deleted: z.number().int() }))
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      // A deletion block that only stopped the background purge would not be a
      // block at all; the manual path has to refuse too, and say why.
      await assertPageDeletable(context.db, {
        id: existing.id,
        spaceId: existing.spaceId,
        organizationId,
      });
      // Child pages go with the parent: leaving them behind would strand them
      // under a parent no reader can reach.
      const subtree = await pageSubtreeIds(context.db, existing.id);
      const now = new Date();
      return context.db.transaction(async (tx) => {
        const deleted = await tx
          .update(page)
          .set({ deletedAt: now, deletedBy: context.session.user.id })
          .where(and(inArray(page.id, subtree), isNull(page.deletedAt)))
          .returning({ id: page.id });
        await recordActivity(tx, {
          organizationId,
          action: "page.deleted",
          ...activityActor(context),
          spaceId: existing.spaceId,
          pageId: existing.id,
          // The page row survives a soft delete, but the title is denormalized
          // anyway so the feed still reads correctly after the purge.
          metadata: { title: existing.title, pages: deleted.length },
        });
        return { id: existing.id, deleted: deleted.length };
      });
    }),

  restore: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/restore",
      tags: TAGS,
      summary: "Restore an archived page to draft",
    })
    .input(z.object({ id: IdSchema }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({ status: "draft", archivedAt: null, lastEditedBy: context.session.user.id })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "page.restored",
          ...activityActor(context),
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title },
        });
        return row;
      });
    }),

  // --- Revisions ---------------------------------------------------------

  listRevisions: protectedProcedure
    .route({
      method: "GET",
      path: "/pages/{id}/revisions",
      tags: TAGS,
      summary: "List a page's version history",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.array(PageRevisionSchema))
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      await requirePageCapability(context.db, context, context.headers, existing, "read");
      return context.db.query.pageRevision.findMany({
        where: eq(pageRevision.pageId, existing.id),
        orderBy: [desc(pageRevision.version)],
      });
    }),

  restoreRevision: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/revisions/{version}/restore",
      tags: TAGS,
      summary: "Restore a page to an earlier revision",
    })
    .input(z.object({ id: IdSchema, version: z.coerce.number().int().positive() }))
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      const { organizationId } = await requirePageCapability(
        context.db,
        context,
        context.headers,
        existing,
        "write",
      );
      const revision = await context.db.query.pageRevision.findFirst({
        where: and(eq(pageRevision.pageId, existing.id), eq(pageRevision.version, input.version)),
      });
      if (!revision) {
        throw new ORPCError("NOT_FOUND", { message: "Revision not found" });
      }
      const restored = await context.db.transaction(async (tx) => {
        const rows = await tx
          .update(page)
          .set({
            title: revision.title,
            content: revision.content,
            textContent: revision.textContent,
            // Drop the live Yjs snapshot: the collab server prefers `yjsState`
            // over `content` when seeding, so leaving it would make the restore a
            // silent no-op on the next open. Cleared, the next fresh session
            // re-seeds from the restored `content`. (An actively-connected collab
            // session still holds the old doc in memory until all clients
            // disconnect — restore from within the editor takes the live path
            // instead; see `RevisionHistory`'s `onRestore`.)
            yjsState: null,
            lastEditedBy: context.session.user.id,
          })
          .where(eq(page.id, existing.id))
          .returning();
        const row = firstRow(rows);
        await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(revision.content));
        await recordActivity(tx, {
          organizationId,
          action: "page.updated",
          ...activityActor(context),
          spaceId: row.spaceId,
          pageId: row.id,
          metadata: { title: row.title, restoredVersion: revision.version },
        });
        return row;
      });
      // A restore can bring a removed mention back. That is a new mention of
      // that person as far as they are concerned, and the diff treats it as one.
      await announcePageMentions(context.db, {
        organizationId,
        page: restored,
        content: revision.content,
        actorId: context.session.user.id,
      });
      return restored;
    }),

  collabToken: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/collab-token",
      tags: TAGS,
      summary: "Mint a short-lived token for the real-time collaboration socket",
    })
    .input(z.object({ id: IdSchema }))
    .output(
      z.object({
        token: z.string(),
        docName: z.string(),
        expiresInSeconds: z.number(),
      }),
    )
    .handler(async ({ input, context }) => {
      const existing = await loadPage(context.db, input.id);
      // The token IS the capability grant, so the full page-write check (incl.
      // the org-manager override and per-page ACLs) runs here, on the
      // authoritative server. The collab process only verifies the signature.
      await requirePageCapability(context.db, context, context.headers, existing, "write");
      const user = context.session.user;
      const token = await signCollabToken(env.BETTER_AUTH_SECRET, {
        u: user.id,
        n: user.name || user.email || "Anonym",
        p: existing.id,
      });
      return {
        token,
        docName: collabDocName(existing.id),
        expiresInSeconds: COLLAB_TOKEN_TTL_SECONDS,
      };
    }),
};
