import { eq } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import { member, user } from "@nilovon-wiki/db/schema/auth";

import { notifyCommentReply, syncMentions, type NotificationPage } from "./deliver";
import { mentionedUserIdsInDocument, mentionedUserIdsInText } from "./mentions";

/**
 * The two places a mention is written, wired to delivery.
 *
 * Both entry points run *after* the mutation committed and swallow their own
 * failures: a save that succeeded must not be reported to the client as an
 * error because a notification could not be written. The mention notices are
 * only advanced on the paths that actually took effect, so a failed run
 * re-evaluates the same difference on the next save rather than losing it.
 */

type PageMentionInput = {
  organizationId: string;
  page: NotificationPage;
  /** The document that was just saved (ProseMirror JSON). */
  content: unknown;
  actorId: string;
};

/** Notifies whoever the saved page body names for the first time. */
export async function announcePageMentions(db: Database, input: PageMentionInput): Promise<void> {
  await quietly("page mentions", input.page.id, async () => {
    await syncMentions(
      db,
      {
        organizationId: input.organizationId,
        page: input.page,
        commentId: null,
        actorId: input.actorId,
      },
      mentionedUserIdsInDocument(input.content),
    );
  });
}

type CommentInput = {
  organizationId: string;
  page: NotificationPage;
  comment: { id: string; parentId: string | null; body: string };
  actorId: string;
  /** False on an edit: the reply itself was already announced when it was posted. */
  isNew: boolean;
};

/**
 * Notifies whoever a comment newly names, plus — for a new reply — the author
 * of the comment it answers. Both are directed events at one person, which is
 * why they share a path (and a de-duplication) rather than the digest's.
 */
export async function announceComment(db: Database, input: CommentInput): Promise<void> {
  await quietly("comment mentions", input.comment.id, async () => {
    const context = {
      organizationId: input.organizationId,
      page: input.page,
      commentId: input.comment.id,
      actorId: input.actorId,
    };
    const mentioned = await syncMentions(
      db,
      context,
      await resolveTextMentions(db, input.organizationId, input.comment.body),
    );
    if (input.isNew && input.comment.parentId) {
      await notifyCommentReply(
        db,
        { ...context, parentCommentId: input.comment.parentId },
        mentioned,
      );
    }
  });
}

/**
 * Comment bodies are plain text, so `@Name` has to be resolved against real
 * people. Scoped to the organization's members — the same set the mention
 * dropdown offers, before per-page access narrows it at delivery.
 */
async function resolveTextMentions(
  db: Database,
  organizationId: string,
  body: string,
): Promise<string[]> {
  if (!body.includes("@")) return [];
  const candidates = await db
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));
  return mentionedUserIdsInText(body, candidates);
}

async function quietly(what: string, id: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[notifications] ${what} failed for ${id}`, error);
  }
}
