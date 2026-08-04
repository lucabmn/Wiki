import { eq, inArray } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { attachment } from "@nilovon-wiki/db/schema/index";

import { getStorage } from "../storage";

/**
 * Removing the bytes behind attachments, in the order that makes a crash
 * recoverable: mark intent in the database, delete the objects, then drop the
 * rows. Interrupted anywhere, the marker (`deletionPendingAt`) survives and the
 * next run finishes the job. The reverse order would leave objects nothing
 * references and nothing ever collects — a bucket that only grows.
 */

export type ObjectPurgeResult = {
  attachmentsDeleted: number;
  /** Rows left behind because object storage is not reachable right now. */
  pending: number;
};

const NOTHING: ObjectPurgeResult = { attachmentsDeleted: 0, pending: 0 };

/**
 * Purges the attachments of the given pages. Returns `pending > 0` when the
 * caller must leave the page itself in place: dropping the page row while its
 * objects are still in the bucket is what orphans them, since
 * `attachment.pageId` nulls rather than cascades.
 */
export async function purgePageAttachments(
  db: Database,
  pageIds: string[],
): Promise<ObjectPurgeResult> {
  if (pageIds.length === 0) return NOTHING;
  const rows = await db
    .update(attachment)
    .set({ deletionPendingAt: new Date() })
    .where(inArray(attachment.pageId, pageIds))
    .returning({ id: attachment.id, storageKey: attachment.storageKey });
  return removeObjects(db, rows);
}

/** Same, for every attachment in a space that is about to be purged. */
export async function purgeSpaceAttachments(
  db: Database,
  spaceId: string,
): Promise<ObjectPurgeResult> {
  const rows = await db
    .update(attachment)
    .set({ deletionPendingAt: new Date() })
    .where(eq(attachment.spaceId, spaceId))
    .returning({ id: attachment.id, storageKey: attachment.storageKey });
  return removeObjects(db, rows);
}

async function removeObjects(
  db: Database,
  rows: { id: string; storageKey: string }[],
): Promise<ObjectPurgeResult> {
  if (rows.length === 0) return NOTHING;
  const storage = getStorage();
  // No storage configured: the marker is already persisted, so the objects are
  // collected by a later run instead of being abandoned. The caller keeps the
  // owning row alive so the link between object and metadata is not lost.
  if (!storage) return { attachmentsDeleted: 0, pending: rows.length };

  const deleted: string[] = [];
  for (const row of rows) {
    // DeleteObject is idempotent, so a retry after an uncertain response is
    // safe. One failure must not abandon the rest of the batch.
    try {
      await storage.delete(row.storageKey);
      deleted.push(row.id);
    } catch {
      // Left pending on purpose: the marker stays and the next run retries.
    }
  }
  if (deleted.length > 0) {
    await db.delete(attachment).where(inArray(attachment.id, deleted));
  }
  return { attachmentsDeleted: deleted.length, pending: rows.length - deleted.length };
}
