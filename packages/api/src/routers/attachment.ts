import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { attachment } from "@nilovon-wiki/db/schema/index";

import { assertOrgPermission, assertOwnerOrPermission, protectedProcedure } from "../index";
import { assertSpaceRead } from "../lib/access";
import { recordActivity } from "../lib/activity";
import { loadAttachment, loadPage, loadSpace, orgOfSpace } from "../lib/loaders";
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
      const spaceId = input.spaceId ?? (await loadPage(context.db, input.pageId!)).spaceId;
      await assertSpaceRead(context.db, context, await loadSpace(context.db, spaceId));
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
      const organizationId = await orgOfSpace(context.db, input.spaceId);
      await assertOrgPermission(context.headers, { attachment: ["create"] }, organizationId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(attachment)
          .values({
            spaceId: input.spaceId,
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
      const organizationId = await orgOfSpace(context.db, existing.spaceId);
      // Uploaders may remove their own (their `create` grant suffices);
      // otherwise `attachment:delete` is needed.
      await assertOwnerOrPermission({
        headers: context.headers,
        organizationId,
        isOwner: existing.uploadedBy === context.session.user.id,
        ownerPermissions: [{ attachment: ["delete"] }, { attachment: ["create"] }],
        otherPermissions: { attachment: ["delete"] },
      });
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
