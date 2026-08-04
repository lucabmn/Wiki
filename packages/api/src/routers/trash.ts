import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { page, space } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure, requireActiveOrg } from "../index";
import type { SpaceAccessInput } from "../lib/access";
import { activityActor, recordActivity } from "../lib/activity";
import { requireSpaceCapability, requireSpaceManage } from "../lib/authz";
import { loadPage, loadSpace } from "../lib/loaders";
import {
  hasHeldPageInSpace,
  isPageHeld,
  isSpaceHeld,
  loadHoldScope,
  pageSubtreeIds,
} from "../lib/retention/holds";
import { loadRetentionPolicy, trashExpiresAt } from "../lib/retention/settings";
import {
  ListTrashedPagesInputSchema,
  TrashedPageSchema,
  TrashedSpaceSchema,
} from "../schemas/retention";
import { IdSchema } from "../schemas/shared";
import { trashPurgeRouter } from "./trash-purge";

const TAGS = ["Trash"];

/**
 * What has been deleted, when it disappears for good, and the way back.
 *
 * Everything here works on trashed rows, so every loader is called with
 * `includeTrashed: true`. That is exactly why the flag exists instead of being
 * the default: outside this file a trashed row must be indistinguishable from a
 * missing one.
 */
const trashViewRouter = {
  listPages: protectedProcedure
    .route({
      method: "GET",
      path: "/spaces/{spaceId}/trash",
      tags: TAGS,
      summary: "Deleted pages in a space, with their expiry",
    })
    .input(ListTrashedPagesInputSchema)
    .output(z.array(TrashedPageSchema))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.spaceId, { includeTrashed: true });
      // The trash lists titles of pages the caller may never have been able to
      // open, so it takes write access to the space rather than mere read.
      await requireSpaceCapability(context.db, context, context.headers, spaceRow, "write");
      const [rows, policy, holds] = await Promise.all([
        context.db.query.page.findMany({
          where: and(eq(page.spaceId, input.spaceId), isNotNull(page.deletedAt)),
          orderBy: [desc(page.deletedAt)],
          columns: {
            id: true,
            spaceId: true,
            title: true,
            icon: true,
            archivedAt: true,
            deletedAt: true,
            deletedBy: true,
          },
        }),
        loadRetentionPolicy(context.db, spaceRow.organizationId),
        loadHoldScope(context.db, spaceRow.organizationId),
      ]);
      return rows.map(({ deletedAt, ...row }) => ({
        ...row,
        // Non-null by the query's own predicate; narrowed here for the schema.
        deletedAt: deletedAt as Date,
        expiresAt: trashExpiresAt(deletedAt as Date, policy.trashRetentionDays),
        held: isPageHeld(holds, { id: row.id, spaceId: row.spaceId }),
      }));
    }),

  listSpaces: protectedProcedure
    .route({
      method: "GET",
      path: "/trash/spaces",
      tags: TAGS,
      summary: "Deleted spaces in the active organization, with their expiry",
    })
    .input(z.object({}))
    .output(z.array(TrashedSpaceSchema))
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const rows = await context.db.query.space.findMany({
        where: and(eq(space.organizationId, organizationId), isNotNull(space.deletedAt)),
        orderBy: [desc(space.deletedAt)],
      });
      if (rows.length === 0) return [];
      const [policy, holds, counts] = await Promise.all([
        loadRetentionPolicy(context.db, organizationId),
        loadHoldScope(context.db, organizationId),
        context.db
          .select({ spaceId: page.spaceId, n: count() })
          .from(page)
          .where(
            inArray(
              page.spaceId,
              rows.map((row) => row.id),
            ),
          )
          .groupBy(page.spaceId),
      ]);
      const pageCounts = new Map(counts.map((row) => [row.spaceId, row.n]));

      const visible = [];
      for (const row of rows) {
        // A trashed space is only listed to whoever could restore it; a plain
        // member has no business enumerating what an admin removed.
        if (!(await canManageSpace(context, row))) continue;
        const deletedAt = row.deletedAt as Date;
        visible.push({
          id: row.id,
          title: row.name,
          slug: row.slug,
          icon: row.icon,
          color: row.color,
          deletedAt,
          deletedBy: row.deletedBy,
          expiresAt: trashExpiresAt(deletedAt, policy.trashRetentionDays),
          held: isSpaceHeld(holds, row.id) || (await hasHeldPageInSpace(context.db, holds, row.id)),
          pageCount: pageCounts.get(row.id) ?? 0,
        });
      }
      return visible;
    }),

  restorePage: protectedProcedure
    .route({
      method: "POST",
      path: "/pages/{id}/untrash",
      tags: TAGS,
      summary: "Restore a page from the trash",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema, restored: z.number().int() }))
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
      if (spaceRow.deletedAt) {
        throw new ORPCError("CONFLICT", {
          message:
            "Der Bereich dieser Seite liegt selbst im Papierkorb. Stelle zuerst den Bereich wieder her.",
        });
      }
      if (!target.deletedAt) return { id: target.id, restored: 0 };
      // Deleting took the subtree, so restoring puts the same subtree back —
      // anything else leaves child pages nobody can reach. `archivedAt` is left
      // alone on purpose: a page archived before it was deleted comes back
      // archived, which is the state its author last chose.
      const subtree = await pageSubtreeIds(context.db, target.id);
      return context.db.transaction(async (tx) => {
        const restored = await tx
          .update(page)
          .set({ deletedAt: null, deletedBy: null })
          .where(and(inArray(page.id, subtree), isNotNull(page.deletedAt)))
          .returning({ id: page.id });
        await recordActivity(tx, {
          organizationId,
          action: "page.untrashed",
          ...activityActor(context),
          spaceId: target.spaceId,
          pageId: target.id,
          metadata: { title: target.title, restored: restored.length },
        });
        return { id: target.id, restored: restored.length };
      });
    }),

  restoreSpace: protectedProcedure
    .route({
      method: "POST",
      path: "/spaces/{id}/untrash",
      tags: TAGS,
      summary: "Restore a space from the trash",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const spaceRow = await loadSpace(context.db, input.id, { includeTrashed: true });
      await requireSpaceManage(context.db, context, context.headers, spaceRow, {
        space: ["delete"],
      });
      if (!spaceRow.deletedAt) return { id: spaceRow.id };
      return context.db.transaction(async (tx) => {
        await tx
          .update(space)
          // `deletionPendingAt` goes too: it marks an in-flight object cleanup,
          // and a restored space has to accept uploads again.
          .set({ deletedAt: null, deletedBy: null, deletionPendingAt: null })
          .where(eq(space.id, spaceRow.id));
        await recordActivity(tx, {
          organizationId: spaceRow.organizationId,
          action: "space.untrashed",
          ...activityActor(context),
          spaceId: spaceRow.id,
          metadata: { name: spaceRow.name },
        });
        return { id: spaceRow.id };
      });
    }),
};

/** Manage check as a predicate — listing skips what it may not show. */
async function canManageSpace(
  context: AuthedContext,
  spaceRow: SpaceAccessInput,
): Promise<boolean> {
  try {
    await requireSpaceManage(context.db, context, context.headers, spaceRow, {
      space: ["delete"],
    });
    return true;
  } catch {
    return false;
  }
}

export const trashRouter = { ...trashViewRouter, ...trashPurgeRouter };
