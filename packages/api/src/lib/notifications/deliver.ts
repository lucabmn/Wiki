import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { comment, mentionNotice, notification } from "@nilovon-wiki/db/schema/index";
import { member } from "@nilovon-wiki/db/schema/auth";

import {
  filterReadablePagesAs,
  isOrgManagerAs,
  loadSpaceRoleAs,
  type PageAccessInput,
} from "../access";
import { loadSpace } from "../loaders";
import { loadPreferencesFor, type DirectNotificationPreferences } from "./direct-settings";

/** The page a directed notification points at, with what access needs to judge it. */
export type NotificationPage = PageAccessInput & { spaceId: string };

export type DeliveryContext = {
  organizationId: string;
  page: NotificationPage;
  /** Null when the mention is in the page body rather than in a comment. */
  commentId: string | null;
  /** Who saved. Never notified about their own action. */
  actorId: string;
};

/**
 * Reconciles the people a source names with the people it named last time, and
 * notifies exactly the difference. Returns the user ids that were notified.
 *
 * Called after the mutation's transaction has committed: a notification about a
 * save that was rolled back would announce something that never happened, and
 * the permission checks below are far too many queries to hold a write lock
 * open for.
 */
export async function syncMentions(
  db: Database,
  context: DeliveryContext,
  mentionedUserIds: string[],
): Promise<string[]> {
  // Self-mentions are dropped before the diff, so they never occupy a notice
  // row and can never be "newly added" later either.
  const current = new Set(mentionedUserIds.filter((id) => id && id !== context.actorId));
  const scope = sourceScope(context);
  const stored = await db
    .select({ id: mentionNotice.id, userId: mentionNotice.userId })
    .from(mentionNotice)
    .where(scope);
  const previous = new Set(stored.map((row) => row.userId));

  const added = [...current].filter((id) => !previous.has(id));
  const removed = stored.filter((row) => !current.has(row.userId));

  if (removed.length > 0) {
    await db.delete(mentionNotice).where(
      inArray(
        mentionNotice.id,
        removed.map((row) => row.id),
      ),
    );
  }
  if (added.length === 0) return [];

  // Written for everyone newly named, including those the checks below silence:
  // the row is the document's state, not a delivery receipt, so re-saving an
  // unchanged document stays silent for them too.
  await db
    .insert(mentionNotice)
    .values(
      added.map((userId) => ({
        pageId: context.page.id,
        commentId: context.commentId,
        userId,
      })),
    )
    .onConflictDoNothing();

  return deliver(db, context, added, context.commentId ? "mention_comment" : "mention_page");
}

/**
 * Notifies the author of the comment being replied to. `alreadyNotified` are
 * the recipients this same reply already reached as a mention — being named in
 * a reply to your own comment is one event, not two.
 */
export async function notifyCommentReply(
  db: Database,
  context: DeliveryContext & { parentCommentId: string },
  alreadyNotified: string[] = [],
): Promise<string[]> {
  const parent = await db.query.comment.findFirst({
    where: and(eq(comment.id, context.parentCommentId), isNull(comment.deletedAt)),
    columns: { authorId: true },
  });
  const recipient = parent?.authorId;
  if (!recipient || recipient === context.actorId || alreadyNotified.includes(recipient)) {
    return [];
  }
  return deliver(db, context, [recipient], "comment_reply");
}

/** Every mention notice attached to one source (a page body or one comment). */
function sourceScope(context: DeliveryContext) {
  return context.commentId
    ? eq(mentionNotice.commentId, context.commentId)
    : and(eq(mentionNotice.pageId, context.page.id), isNull(mentionNotice.commentId));
}

type NotificationType = "mention_page" | "mention_comment" | "comment_reply";

const PREFERENCE_OF: Record<NotificationType, keyof DirectNotificationPreferences> = {
  mention_page: "mentions",
  mention_comment: "mentions",
  comment_reply: "commentReplies",
};

/**
 * Writes one inbox row per recipient that may have it — after two gates that a
 * notification, being an information channel of its own, has to pass:
 *
 *  1. Access. Someone who cannot read the page is told nothing about it, not
 *     even that it exists: the title alone can be confidential, and the
 *     mentionable member list is space-scoped while a per-page override can be
 *     narrower.
 *  2. The recipient's own setting.
 */
async function deliver(
  db: Database,
  context: DeliveryContext,
  recipients: string[],
  type: NotificationType,
): Promise<string[]> {
  const eligible = await filterByAccess(db, context, recipients);
  if (eligible.length === 0) return [];

  const preferences = await loadPreferencesFor(db, eligible, context.organizationId);
  const wanted = eligible.filter((userId) => preferences.get(userId)?.[PREFERENCE_OF[type]]);
  if (wanted.length === 0) return [];

  await db.insert(notification).values(
    wanted.map((userId) => ({
      organizationId: context.organizationId,
      userId,
      type,
      actorId: context.actorId,
      pageId: context.page.id,
      commentId: context.commentId,
    })),
  );
  return wanted;
}

/** Recipients who are org members and may actually read the page. */
async function filterByAccess(
  db: Database,
  context: DeliveryContext,
  recipients: string[],
): Promise<string[]> {
  const memberships = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(eq(member.organizationId, context.organizationId), inArray(member.userId, recipients)),
    );
  const members = new Set(memberships.map((row) => row.userId));
  if (members.size === 0) return [];

  const spaceRow = await loadSpace(db, context.page.spaceId);
  const allowed: string[] = [];
  for (const userId of recipients) {
    if (!members.has(userId)) continue;
    const principal = { userId, organizationId: context.organizationId };
    const manager = await isOrgManagerAs(db, userId, context.organizationId);
    const spaceRole = await loadSpaceRoleAs(db, principal, spaceRow, manager);
    if (!spaceRole) continue;
    // Resolves the page's own ACL on top of the space role — the narrower of
    // the two wins, which is exactly the case this gate exists for.
    const readable = await filterReadablePagesAs(db, principal, [context.page], spaceRole);
    if (readable.length > 0) allowed.push(userId);
  }
  return allowed;
}
