import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { page, space } from "@nilovon-wiki/db/schema/index";

import { recordActivity } from "../activity";
import { isPageHeld, isSpaceHeld, hasHeldPageInSpace, type HoldScope } from "./holds";
import { purgePageAttachments, purgeSpaceAttachments } from "./objects";

export type TrashPurgeResult = {
  pagesPurged: number;
  spacesPurged: number;
  attachmentsPurged: number;
  /** Rows past their expiry that a hold kept alive. */
  heldSkipped: number;
  /** Rows whose objects could not be removed yet; the row stays for a retry. */
  pending: number;
  batchLimitReached: boolean;
};

const EMPTY: TrashPurgeResult = {
  pagesPurged: 0,
  spacesPurged: 0,
  attachmentsPurged: 0,
  heldSkipped: 0,
  pending: 0,
  batchLimitReached: false,
};

/**
 * Removes pages and spaces that have sat in the trash past their window.
 *
 * Objects in the store go first (see `objects.ts`): a page row dropped while its
 * attachments are still in the bucket orphans those bytes forever, because
 * `attachment.pageId` nulls on delete instead of cascading. A page whose objects
 * could not be removed is therefore left in the trash — expired but present —
 * and retried on the next run rather than losing the link to its bytes.
 */
export async function purgeExpiredTrash(
  db: Database,
  input: {
    organizationId: string;
    cutoff: Date;
    batchLimit: number;
    holds: HoldScope;
    actorId?: string | null;
  },
): Promise<TrashPurgeResult> {
  const { batchLimit, holds } = input;
  if (holds.organization) return EMPTY;

  const pages = await purgeExpiredPages(db, input);
  // Spaces share the ceiling with pages: one run must not be able to do twice
  // the work the operator sized the batch for.
  const remaining = batchLimit - pages.pagesPurged - pages.heldSkipped;
  if (remaining <= 0) {
    return { ...pages, batchLimitReached: true };
  }
  const spaces = await purgeExpiredSpaces(db, { ...input, batchLimit: remaining });

  return {
    pagesPurged: pages.pagesPurged,
    spacesPurged: spaces.spacesPurged,
    attachmentsPurged: pages.attachmentsPurged + spaces.attachmentsPurged,
    heldSkipped: pages.heldSkipped + spaces.heldSkipped,
    pending: pages.pending + spaces.pending,
    batchLimitReached: pages.batchLimitReached || spaces.batchLimitReached,
  };
}

async function purgeExpiredPages(
  db: Database,
  input: {
    organizationId: string;
    cutoff: Date;
    batchLimit: number;
    holds: HoldScope;
    actorId?: string | null;
  },
): Promise<TrashPurgeResult> {
  const candidates = await db
    .select({ id: page.id, spaceId: page.spaceId, title: page.title })
    .from(page)
    .innerJoin(space, eq(page.spaceId, space.id))
    .where(
      and(
        eq(space.organizationId, input.organizationId),
        isNotNull(page.deletedAt),
        lt(page.deletedAt, input.cutoff),
      ),
    )
    .orderBy(asc(page.deletedAt))
    .limit(input.batchLimit);
  if (candidates.length === 0) return EMPTY;

  const batchLimitReached = candidates.length === input.batchLimit;
  const removable = candidates.filter((row) => !isPageHeld(input.holds, row));
  const heldSkipped = candidates.length - removable.length;
  if (removable.length === 0) return { ...EMPTY, heldSkipped, batchLimitReached };

  const objects = await purgePageAttachments(
    db,
    removable.map((row) => row.id),
  );
  // Something is still in the bucket for this batch: keep every candidate for
  // the next run rather than guessing which page the leftover belonged to.
  if (objects.pending > 0) {
    return {
      ...EMPTY,
      attachmentsPurged: objects.attachmentsDeleted,
      pending: objects.pending,
      heldSkipped,
      batchLimitReached,
    };
  }

  await db.transaction(async (tx) => {
    await tx.delete(page).where(
      inArray(
        page.id,
        removable.map((row) => row.id),
      ),
    );
    for (const row of removable) {
      // `activity.pageId` nulls when the page goes, so the identity that makes
      // this row readable later has to live in the metadata.
      await recordActivity(tx, {
        organizationId: input.organizationId,
        action: "page.purged",
        actorId: input.actorId ?? null,
        spaceId: row.spaceId,
        metadata: { pageId: row.id, title: row.title, reason: "retention" },
      });
    }
  });

  return {
    pagesPurged: removable.length,
    spacesPurged: 0,
    attachmentsPurged: objects.attachmentsDeleted,
    heldSkipped,
    pending: 0,
    batchLimitReached,
  };
}

async function purgeExpiredSpaces(
  db: Database,
  input: {
    organizationId: string;
    cutoff: Date;
    batchLimit: number;
    holds: HoldScope;
    actorId?: string | null;
  },
): Promise<TrashPurgeResult> {
  const candidates = await db
    .select({ id: space.id, name: space.name })
    .from(space)
    .where(
      and(
        eq(space.organizationId, input.organizationId),
        isNotNull(space.deletedAt),
        lt(space.deletedAt, input.cutoff),
      ),
    )
    .orderBy(asc(space.deletedAt))
    .limit(input.batchLimit);
  if (candidates.length === 0) return EMPTY;

  const batchLimitReached = candidates.length === input.batchLimit;
  let purged = 0;
  let attachmentsPurged = 0;
  let heldSkipped = 0;
  let pending = 0;

  for (const candidate of candidates) {
    // A hold on any page inside the space blocks the space too — the cascade
    // would otherwise take the held page with it.
    if (
      isSpaceHeld(input.holds, candidate.id) ||
      (await hasHeldPageInSpace(db, input.holds, candidate.id))
    ) {
      heldSkipped += 1;
      continue;
    }
    const objects = await purgeSpaceAttachments(db, candidate.id);
    attachmentsPurged += objects.attachmentsDeleted;
    if (objects.pending > 0) {
      pending += objects.pending;
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.delete(space).where(eq(space.id, candidate.id));
      await recordActivity(tx, {
        organizationId: input.organizationId,
        action: "space.purged",
        actorId: input.actorId ?? null,
        metadata: { spaceId: candidate.id, name: candidate.name, reason: "retention" },
      });
    });
    purged += 1;
  }

  return {
    pagesPurged: 0,
    spacesPurged: purged,
    attachmentsPurged,
    heldSkipped,
    pending,
    batchLimitReached,
  };
}
