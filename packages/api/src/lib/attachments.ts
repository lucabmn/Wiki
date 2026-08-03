import { ORPCError } from "@orpc/server";

import { attachment } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import type { Attachment } from "../schemas/attachment";
import { recordActivity } from "./activity";
import { requirePageCapability, requireSpaceCapabilityById } from "./authz";
import { loadPage, loadSpace } from "./loaders";
import { firstRow } from "./rows";
import { buildStorageKey, getStorage } from "./storage";

/**
 * Stores an uploaded file and records its metadata row, in that order, as one
 * user-visible operation.
 *
 * The storage key is derived server-side and never accepted from the client:
 * a client-chosen key would let a caller register a row pointing at another
 * space's object and then read it back through the download proxy.
 */
export async function createAttachment(
  context: AuthedContext,
  input: {
    spaceId: string;
    pageId?: string | null;
    draft?: boolean;
    file: { name: string; type: string; size: number; body: Blob };
  },
): Promise<Attachment> {
  const storage = getStorage();
  if (!storage) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message: "Attachments are disabled: no object storage is configured (see S3_* in .env).",
    });
  }

  // Attaching to a page requires write on that page; a bare space upload
  // requires write on the space. The row's spaceId comes from the checked
  // resource, never from the client alongside a pageId — otherwise write access
  // to one page would allow planting rows in a foreign space.
  let organizationId: string;
  let spaceId: string;
  let isDraft = false;
  let publishOnNextPublish = false;
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
    // A client cannot make bytes on a never-published page reader-visible.
    // Sidebar uploads queue for first publication; editor/import assets stay
    // private unless the published document actually references them.
    isDraft = Boolean(input.draft) || target.publishedAt === null;
    publishOnNextPublish = !input.draft && target.publishedAt === null;
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

  // A pending space deletion must not accept new objects after its cleanup
  // snapshot was persisted, or the final cascade could orphan those bytes.
  const targetSpace = await loadSpace(context.db, spaceId);
  if (targetSpace.deletionPendingAt) {
    throw new ORPCError("CONFLICT", { message: "Space deletion is already in progress." });
  }

  const storageKey = buildStorageKey(spaceId, input.file.name);
  await storage.upload(storageKey, input.file.body, { contentType: input.file.type });

  try {
    return await context.db.transaction(async (tx) => {
      const rows = await tx
        .insert(attachment)
        .values({
          spaceId,
          pageId: input.pageId ?? null,
          fileName: input.file.name,
          mimeType: input.file.type,
          size: input.file.size,
          storageKey,
          uploadedBy: context.session.user.id,
          isDraft,
          publishOnNextPublish,
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
  } catch (error) {
    // The bytes are already in the bucket; without this the failed insert would
    // leave an object no row references and nothing ever collects.
    await storage.delete(storageKey).catch(() => {});
    throw error;
  }
}
