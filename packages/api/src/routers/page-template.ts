import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { page } from "@nilovon-wiki/db/schema/index";

import { isOrgManager, protectedProcedure } from "../index";
import { filterReadablePages, loadSpaceRole } from "../lib/access";
import { recordActivity } from "../lib/activity";
import { requirePageCapability, requireSpaceCapabilityById } from "../lib/authz";
import { loadPage, loadSpace } from "../lib/loaders";
import { extractPageLinks, syncPageLinks } from "../lib/page-links";
import { assertParentInSpace, positionAtEnd } from "../lib/page-tree";
import { isAttachmentUrl, stripAttachmentReferences, templateExcerpt } from "../lib/page-templates";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CreateFromTemplateInputSchema,
  ListTemplatesInputSchema,
  PageSchema,
  PageTemplateSchema,
} from "../schemas/page";

const TAGS = ["Pages"];

/**
 * Page templates. Templates are ordinary pages carrying `isTemplate` and living
 * in a space like everything else — the space's access rules therefore apply to
 * them unchanged, which is why there is no separate permission model here. A
 * page becomes (or stops being) a template through `pages.update`, so marking
 * one needs exactly the rights that editing it needs.
 */
export const pageTemplateRouter = {
  listTemplates: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces/{spaceId}/templates",
      tags: TAGS,
      summary: "List the page templates of a space",
    })
    .input(ListTemplatesInputSchema)
    .output(z.array(PageTemplateSchema))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.spaceId);
      const manager = await isOrgManager(context.headers, spaceRow.organizationId);
      const spaceRole = await loadSpaceRole(context.db, context, spaceRow, manager);
      if (spaceRole === null) throw new ORPCError("FORBIDDEN");
      const rows = await context.db.query.page.findMany({
        where: and(
          eq(page.spaceId, input.spaceId),
          eq(page.isTemplate, true),
          isNull(page.archivedAt),
        ),
        orderBy: [asc(page.title)],
      });
      // A template can carry a per-page ACL like any other page.
      const readable = await filterReadablePages(context.db, context, rows, spaceRole);
      return readable.map((row) => ({
        id: row.id,
        spaceId: row.spaceId,
        title: row.title,
        icon: row.icon,
        excerpt: templateExcerpt(row.textContent),
        hasContent: row.content !== null,
        status: row.status,
        updatedAt: row.updatedAt,
      }));
    }),

  createFromTemplate: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/from-template",
      tags: TAGS,
      summary: "Create a page from a template",
    })
    .input(CreateFromTemplateInputSchema)
    .output(PageSchema)
    .handler(async ({ input, context }) => {
      const template = await loadPage(context.db, input.templateId);
      // Read on the template *and* write at the destination. Checking only the
      // destination would turn every template in a restricted space into a
      // readable copy for anyone who can write somewhere else.
      await requirePageCapability(context.db, context, context.headers, template, "read");
      if (!template.isTemplate) {
        throw new ORPCError("BAD_REQUEST", { message: "This page is not a template" });
      }
      const { organizationId } = await requireSpaceCapabilityById(
        context.db,
        context,
        context.headers,
        input.spaceId,
        "write",
      );

      const parentId = input.parentId ?? null;
      await assertParentInSpace(context.db, parentId, input.spaceId);
      const title = input.title?.trim() || template.title;
      const slug = await uniqueSlug(
        slugify(title),
        async (candidate) =>
          !!(await context.db.query.page.findFirst({
            where: and(eq(page.spaceId, input.spaceId), eq(page.slug, candidate)),
            columns: { id: true },
          })),
      );
      const position = await positionAtEnd(context.db, input.spaceId, parentId);
      const userId = context.session.user.id;
      // The copied body is the template's *published* projection: content only
      // advances on publish, so an unpublished template's text still lives in
      // its collab document. `listTemplates` reports that as `hasContent: false`
      // instead of silently handing out an empty page.
      const content = stripAttachmentReferences(template.content);

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            // A generated page is a copy, not a link: comments, attachments,
            // tags, per-page ACLs and revisions stay with the template, and a
            // later edit of the template never reaches back into this page.
            // `yjsState` is emphatically not copied — the collab server seeds a
            // fresh document from `content`, and a shared CRDT state would give
            // two pages the same document identity.
            const rows = await tx
              .insert(page)
              .values({
                spaceId: input.spaceId,
                parentId,
                title,
                slug,
                icon: template.icon,
                // Cover images are usually attachment-backed, so the rule that
                // governs the body governs them too; an external URL carries over.
                coverImage:
                  template.coverImage && !isAttachmentUrl(template.coverImage)
                    ? template.coverImage
                    : null,
                content,
                textContent: template.textContent,
                status: "draft",
                isTemplate: false,
                position,
                createdBy: userId,
                lastEditedBy: userId,
              })
              .returning();
            const row = firstRow(rows);
            await syncPageLinks(tx, row.id, row.spaceId, extractPageLinks(content));
            await recordActivity(tx, {
              organizationId,
              action: "page.created",
              actorId: userId,
              spaceId: row.spaceId,
              pageId: row.id,
              metadata: { title: row.title, source: "template", templateId: template.id },
            });
            return row;
          }),
        "A page with this slug already exists in the space",
      );
    }),
};
