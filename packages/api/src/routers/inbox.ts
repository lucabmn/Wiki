import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { comment, notification, page } from "@nilovon-wiki/db/schema/index";
import { user } from "@nilovon-wiki/db/schema/auth";

import type { AuthedContext } from "../context";
import { protectedProcedure, requireActiveOrg } from "../index";
import { readableSpaceIds } from "../lib/access";
import { filterReadablePagesAcrossSpaces } from "../lib/authz";
import { pageNotTrashed } from "../lib/lifecycle";
import { InboxItemSchema, ListInboxInputSchema, type InboxItem } from "../schemas/inbox";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Inbox"];

/** How much of a comment the list quotes. */
const EXCERPT_LENGTH = 160;

/**
 * Rows scanned for the unread badge. The badge is a signal, not a report — it
 * caps at "99+" in the UI anyway — and every row costs an access re-check.
 */
const BADGE_SCAN_LIMIT = 100;

/**
 * The personal inbox: directed events (being named, being replied to), as
 * opposed to the digest's broadcast.
 *
 * Access is re-checked on read, not only on delivery. A page can be restricted
 * *after* a notification for it was written, and the row carries the page title
 * — so a stale inbox entry would keep leaking exactly what the delivery gate
 * was there to protect. Rows that no longer pass are simply not returned; they
 * are left in place, because the restriction may be temporary.
 */
export const inboxRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/me/inbox", tags: TAGS, summary: "The caller's notifications" })
    .input(ListInboxInputSchema)
    .output(z.array(InboxItemSchema))
    .handler(async ({ input, context }) => {
      return loadInbox(context, { onlyUnread: input.onlyUnread, limit: input.limit });
    }),

  unreadCount: protectedProcedure
    .route({
      method: "GET",
      path: "/me/inbox/unread-count",
      tags: TAGS,
      summary: "How many unread notifications the caller can see",
    })
    .input(z.object({}))
    .output(z.object({ count: z.number().int().min(0), capped: z.boolean() }))
    .handler(async ({ context }) => {
      const rows = await loadInbox(context, { onlyUnread: true, limit: BADGE_SCAN_LIMIT });
      return { count: rows.length, capped: rows.length === BADGE_SCAN_LIMIT };
    }),

  markRead: protectedProcedure
    .route({
      method: "POST",
      path: "/me/inbox/{id}/read",
      tags: TAGS,
      summary: "Mark one notification read or unread",
    })
    .input(z.object({ id: IdSchema, read: z.boolean().default(true) }))
    .output(z.object({ id: IdSchema, readAt: z.date().nullable() }))
    .handler(async ({ input, context }) => {
      // Scoped to the caller's own rows: the id alone must never be enough.
      const rows = await context.db
        .update(notification)
        .set({ readAt: input.read ? new Date() : null })
        .where(
          and(
            eq(notification.id, input.id),
            eq(notification.userId, context.session.user.id),
            eq(notification.organizationId, requireActiveOrg(context)),
          ),
        )
        .returning({ id: notification.id, readAt: notification.readAt });
      return rows[0] ?? { id: input.id, readAt: null };
    }),

  markAllRead: protectedProcedure
    .route({
      method: "POST",
      path: "/me/inbox/read-all",
      tags: TAGS,
      summary: "Mark every notification read",
    })
    .input(z.object({}))
    .output(z.object({ marked: z.number().int().min(0) }))
    .handler(async ({ context }) => {
      const rows = await context.db
        .update(notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notification.userId, context.session.user.id),
            eq(notification.organizationId, requireActiveOrg(context)),
            isNull(notification.readAt),
          ),
        )
        .returning({ id: notification.id });
      return { marked: rows.length };
    }),
};

/** The joined rows, filtered to what the caller may still read. */
async function loadInbox(
  context: AuthedContext,
  options: { onlyUnread: boolean; limit: number },
): Promise<InboxItem[]> {
  const organizationId = requireActiveOrg(context);
  const spaceIds = await readableSpaceIds(context.db, context, organizationId);
  if (spaceIds.length === 0) return [];

  const rows = await context.db
    .select({
      id: notification.id,
      type: notification.type,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      commentId: notification.commentId,
      actorId: user.id,
      actorName: user.name,
      pageId: page.id,
      title: page.title,
      icon: page.icon,
      body: comment.body,
      // Carried only so the per-page ACL can be evaluated below.
      spaceId: page.spaceId,
      visibility: page.visibility,
      createdBy: page.createdBy,
    })
    .from(notification)
    .innerJoin(page, eq(notification.pageId, page.id))
    .leftJoin(user, eq(notification.actorId, user.id))
    .leftJoin(comment, eq(notification.commentId, comment.id))
    .where(
      and(
        eq(notification.userId, context.session.user.id),
        eq(notification.organizationId, organizationId),
        inArray(page.spaceId, spaceIds),
        pageNotTrashed(),
        isNull(page.archivedAt),
        // Also true for rows without a comment, and false once that comment is
        // deleted — a notification pointing at nothing is noise.
        isNull(comment.deletedAt),
        options.onlyUnread ? isNull(notification.readAt) : undefined,
      ),
    )
    .orderBy(desc(notification.createdAt), desc(sql`${notification.id}`))
    .limit(options.limit);

  // Space read is necessary but not sufficient — a per-page override can be
  // narrower, and the title on each row is the thing it protects.
  const readable = await filterReadablePagesAcrossSpaces(
    context.db,
    context,
    context.headers,
    rows.map((row) => ({
      id: row.pageId,
      spaceId: row.spaceId,
      visibility: row.visibility,
      createdBy: row.createdBy,
    })),
  );
  const allowed = new Set(readable.map((row) => row.id));

  return rows
    .filter((row) => allowed.has(row.pageId))
    .map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      readAt: row.readAt,
      actor: row.actorId ? { id: row.actorId, name: row.actorName ?? "" } : null,
      page: { id: row.pageId, title: row.title, icon: row.icon },
      commentId: row.commentId,
      excerpt: row.body ? excerpt(row.body) : null,
    }));
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}
