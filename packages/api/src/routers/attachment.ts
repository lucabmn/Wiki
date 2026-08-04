import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { attachment } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import { protectedProcedure } from "../index";
import { assertSpaceRead } from "../lib/access";
import { requireOwnerOrSpaceCapability, requirePageCapability } from "../lib/authz";
import { activityActor, recordActivity } from "../lib/activity";
import { loadAttachment, loadPage, loadSpace } from "../lib/loaders";
import { getStorage } from "../lib/storage";
import { AttachmentSchema, ListAttachmentsInputSchema } from "../schemas/attachment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Attachments"];

export const attachmentRouter = {
  capabilities: protectedProcedure
    .route({
      method: "GET",
      path: "/attachments/capabilities",
      tags: TAGS,
      summary: "Get attachment storage capabilities",
    })
    .input(z.object({}))
    .output(z.object({ enabled: z.boolean(), maxUploadBytes: z.number().int().positive() }))
    .handler(() => ({
      enabled: getStorage() !== null,
      maxUploadBytes: env.ATTACHMENT_MAX_MB * 1024 * 1024,
    })),

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
      let canReadDrafts = false;
      if (input.pageId) {
        const target = await loadPage(context.db, input.pageId);
        await requirePageCapability(context.db, context, context.headers, target, "read");
        spaceId = target.spaceId;
        try {
          await requirePageCapability(context.db, context, context.headers, target, "write");
          canReadDrafts = true;
        } catch (error) {
          if (!(error instanceof ORPCError) || error.code !== "FORBIDDEN") throw error;
        }
      } else {
        spaceId = input.spaceId!;
        await assertSpaceRead(context.db, context, await loadSpace(context.db, spaceId));
      }
      const rows = await context.db.query.attachment.findMany({
        where: and(
          eq(attachment.spaceId, spaceId),
          input.pageId ? eq(attachment.pageId, input.pageId) : undefined,
        ),
        orderBy: [desc(attachment.createdAt)],
      });
      return canReadDrafts ? rows : rows.filter((row) => !row.isDraft);
    }),

  // Metadata for one attachment, gated on read access to its page (or space for
  // a page-less upload). The download proxy in `apps/server` calls this to
  // authorize before it streams any bytes.
  get: protectedProcedure
    .route({
      method: "GET",
      path: "/attachments/{id}",
      tags: TAGS,
      summary: "Get one attachment's metadata",
    })
    .input(z.object({ id: IdSchema }))
    .output(AttachmentSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadAttachment(context.db, input.id);
      if (existing.pageId) {
        const target = await loadPage(context.db, existing.pageId);
        await requirePageCapability(
          context.db,
          context,
          context.headers,
          target,
          existing.isDraft ? "write" : "read",
        );
      } else {
        await assertSpaceRead(context.db, context, await loadSpace(context.db, existing.spaceId));
      }
      return existing;
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
      // Persist intent before touching object storage. If storage or the final
      // DB transaction fails, repeating this request safely resumes deletion.
      await context.db
        .update(attachment)
        .set({ deletionPendingAt: existing.deletionPendingAt ?? new Date() })
        .where(eq(attachment.id, input.id));
      const storage = getStorage();
      if (!storage) {
        throw new ORPCError("NOT_IMPLEMENTED", {
          message: "Cannot delete attachment: no object storage is configured.",
        });
      }
      // S3 DeleteObject is idempotent, so retrying after an uncertain response
      // or a later DB failure is safe.
      await storage.delete(existing.storageKey);
      await context.db.transaction(async (tx) => {
        await tx.delete(attachment).where(eq(attachment.id, input.id));
        // The attachment row is hard-deleted, so keep identifying info in
        // metadata — the audit row must survive the row it describes.
        await recordActivity(tx, {
          organizationId,
          action: "attachment.deleted",
          ...activityActor(context),
          spaceId: existing.spaceId,
          pageId: existing.pageId,
          metadata: { attachmentId: existing.id, fileName: existing.fileName },
        });
      });
      return { id: input.id };
    }),
};
