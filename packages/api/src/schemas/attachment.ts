import { z } from "zod";

import { IdSchema } from "./shared";

export const AttachmentSchema = z.object({
  id: IdSchema,
  spaceId: IdSchema,
  pageId: IdSchema.nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  storageKey: z.string(),
  checksum: z.string().nullable(),
  uploadedBy: IdSchema.nullable(),
  isDraft: z.boolean(),
  publishOnNextPublish: z.boolean(),
  createdAt: z.date(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const ListAttachmentsInputSchema = z
  .object({
    spaceId: IdSchema.optional(),
    pageId: IdSchema.optional(),
  })
  .refine((v) => v.spaceId || v.pageId, {
    message: "provide spaceId or pageId",
  });

/**
 * Registers an already-uploaded object. Binary upload itself is handled out of
 * band (presigned URL / direct storage); this records the metadata row.
 */
export const CreateAttachmentInputSchema = z.object({
  spaceId: IdSchema,
  pageId: IdSchema.nullish(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  storageKey: z.string().min(1).max(1024),
  checksum: z.string().max(128).nullish(),
});
