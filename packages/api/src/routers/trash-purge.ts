import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { page, space } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requireSpaceCapability, requireSpaceManage } from "../lib/authz";
import { loadPage, loadSpace } from "../lib/loaders";
import { assertPageDeletable, assertSpaceDeletable, pageSubtreeIds } from "../lib/retention/holds";
import { purgePageAttachments, purgeSpaceAttachments } from "../lib/retention/objects";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Trash"];

/**
 * "Delete permanently, now" — the escape hatch from waiting out the trash
 * window. Same rules as the background runner, deliberately: a deletion block
 * that only stopped the job would be defeated by clicking a button, and object
 * storage is cleaned up in the same order (bytes first, row second) so an
 * interrupted purge leaves something retryable instead of orphaned bytes.
 */
export const trashPurgeRouter = {
  purgePage: protectedProcedure
    .route({
      method: "DELETE",
      path: "/pages/{id}/purge",
      tags: TAGS,
      summary: "Delete a trashed page permanently, now",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema, purged: z.number().int() }))
    .handler(async ({ input, context }) => {
      const target = await loadPage(context.db, input.id, { includeTrashed: true });
      const spaceRow = await loadSpace(context.db, target.spaceId, { includeTrashed: true });
      const { organizationId } = await requireSpaceCapability(
        context.db,
        context,
        context.headers,
        spaceRow,
        "write",
      );
      if (!target.deletedAt) {
        throw new ORPCError("CONFLICT", {
          message: "Nur Seiten im Papierkorb können endgültig gelöscht werden.",
        });
      }
      await assertPageDeletable(context.db, {
        id: target.id,
        spaceId: target.spaceId,
        organizationId,
      });

      const subtree = await pageSubtreeIds(context.db, target.id);
      const objects = await purgePageAttachments(context.db, subtree);
      if (objects.pending > 0) {
        // The page stays in the trash rather than losing the link to its bytes.
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "Anhänge konnten nicht entfernt werden. Bitte später erneut versuchen.",
        });
      }
      await context.db.transaction(async (tx) => {
        await tx.delete(page).where(inArray(page.id, subtree));
        // `activity.pageId` nulls when the page goes, so its identity has to
        // survive in the metadata for the audit row to still mean something.
        await recordActivity(tx, {
          organizationId,
          action: "page.purged",
          ...activityActor(context),
          spaceId: target.spaceId,
          metadata: { pageId: target.id, title: target.title, pages: subtree.length },
        });
      });
      return { id: target.id, purged: subtree.length };
    }),

  purgeSpace: protectedProcedure
    .route({
      method: "DELETE",
      path: "/spaces/{id}/purge",
      tags: TAGS,
      summary: "Delete a trashed space permanently, now",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.id, { includeTrashed: true });
      await requireSpaceManage(context.db, context, context.headers, spaceRow, {
        space: ["delete"],
      });
      if (!spaceRow.deletedAt) {
        throw new ORPCError("CONFLICT", {
          message: "Nur Bereiche im Papierkorb können endgültig gelöscht werden.",
        });
      }
      await assertSpaceDeletable(context.db, spaceRow);

      // Marked before storage is touched so an interrupted cleanup is resumable
      // rather than half-done; also stops new uploads landing mid-purge.
      await context.db
        .update(space)
        .set({ deletionPendingAt: spaceRow.deletionPendingAt ?? new Date() })
        .where(eq(space.id, spaceRow.id));
      const objects = await purgeSpaceAttachments(context.db, spaceRow.id);
      if (objects.pending > 0) {
        throw new ORPCError("SERVICE_UNAVAILABLE", {
          message: "Anhänge konnten nicht entfernt werden. Bitte später erneut versuchen.",
        });
      }
      await context.db.transaction(async (tx) => {
        await tx.delete(space).where(eq(space.id, spaceRow.id));
        await recordActivity(tx, {
          organizationId: spaceRow.organizationId,
          action: "space.purged",
          ...activityActor(context),
          metadata: { spaceId: spaceRow.id, name: spaceRow.name },
        });
      });
      return { id: spaceRow.id };
    }),
};
