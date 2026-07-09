import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { attachment } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { assertSpaceRead } from "../lib/access";
import {
  requireOwnerOrSpaceCapability,
  requirePageCapability,
  requireSpaceCapabilityById,
} from "../lib/authz";
import { recordActivity } from "../lib/activity";
import { loadAttachment, loadPage, loadSpace } from "../lib/loaders";
import { firstRow } from "../lib/rows";
import {
  AttachmentSchema,
  CreateAttachmentInputSchema,
  ListAttachmentsInputSchema,
} from "../schemas/attachment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Attachments"];

export const attachmentRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/attachments",
      tags: TAGS,
      summary: "List attachments by space or page",
    })
    .input(ListAttachmentsInputSchema)
    .output(z.array(AttachmentSchema))
    .handler(async ({ input, context }) => {
      let spaceId: string;
      if (input.pageId) {
        const target = await loadPage(context.db, input.pageId);
        await requirePageCapability(context.db, context, context.headers, target, "read");
        spaceId = target.spaceId;
      } else {
        spaceId = input.spaceId!;
        await assertSpaceRead(context.db, context, await loadSpace(context.db, spaceId));
      }
      return context.db.query.attachment.findMany({
        where: and(
          eq(attachment.spaceId, spaceId),
          input.pageId ? eq(attachment.pageId, input.pageId) : undefined,
        ),
        orderBy: [desc(attachment.createdAt)],
      });
    }),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/attachments",
      tags: TAGS,
      summary: "Register an uploaded attachment",
    })
    .input(CreateAttachmentInputSchema)
    .output(AttachmentSchema)
    .handler(async ({ input, context }) => {
      // Attaching to a page requires write on that page; a bare space upload
      // requires write on the space. The row's spaceId is derived from the
      // checked resource — never taken from the client alongside a pageId, or
      // write access to one page would allow planting rows in foreign spaces.
      let organizationId: string;
      let spaceId: string;
      if (input.pageId) {
        const target = await loadPage(context.db, input.pageId);
        ({ organizationId } = await requirePageCapability(
          context.db,
          context,
          context.headers,
          target,
          "write",
        ));
        spaceId = target.spaceId;
      } else {
        ({ organizationId } = await requireSpaceCapabilityById(
          context.db,
          context,
          context.headers,
          input.spaceId,
          "write",
        ));
        spaceId = input.spaceId;
      }
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(attachment)
          .values({
            spaceId,
            pageId: input.pageId ?? null,
            fileName: input.fileName,
            mimeType: input.mimeType,
            size: input.size,
            storageKey: input.storageKey,
            checksum: input.checksum ?? null,
            uploadedBy: context.session.user.id,
          })
          .returning();
        const row = firstRow(rows);
        await recordActivity(tx, {
          organizationId,
          action: "attachment.uploaded",
          actorId: context.session.user.id,
          spaceId: row.spaceId,
          pageId: row.pageId,
          metadata: { fileName: row.fileName, attachmentId: row.id },
        });
        return row;
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/attachments/{id}",
      tags: TAGS,
      summary: "Delete an attachment",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadAttachment(context.db, input.id);
      const space = await loadSpace(context.db, existing.spaceId);
      // Uploaders may remove their own; otherwise space editor+ is required.
      await requireOwnerOrSpaceCapability(context.db, context, context.headers, space, {
        isOwner: existing.uploadedBy === context.session.user.id,
        capability: "write",
      });
      const organizationId = space.organizationId;
      await context.db.transaction(async (tx) => {
        await tx.delete(attachment).where(eq(attachment.id, input.id));
        // The attachment row is hard-deleted, so keep identifying info in
        // metadata — the audit row must survive the row it describes.
        await recordActivity(tx, {
          organizationId,
          action: "attachment.deleted",
          actorId: context.session.user.id,
          spaceId: existing.spaceId,
          pageId: existing.pageId,
          metadata: { attachmentId: existing.id, fileName: existing.fileName },
        });
      });
      return { id: input.id };
    }),
};
