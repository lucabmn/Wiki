import { parseCommentAnchor, type CommentAnchor } from "@nilovon-wiki/editor/comment-anchor";

/** The fields of a comment row this module needs; the API returns a superset. */
export type CommentRow = {
  id: string;
  parentId: string | null;
  authorId: string | null;
  body: string;
  anchor: unknown;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type InlineThread = {
  /** Identity of the thread — the mark it hangs on. Stable across reloads. */
  markId: string;
  anchor: CommentAnchor;
  root: CommentRow;
  replies: CommentRow[];
  resolved: boolean;
  /**
   * The mark is not in the rendered document: the annotated text was deleted,
   * or the page hasn't been published since the comment was made. Either way
   * the thread stays — shown against `anchor.excerpt` instead of a position.
   */
  orphaned: boolean;
  /** Offset of the highlight inside the content container, in px. 0 for orphans. */
  top: number;
};

const MAX_THREAD_DEPTH = 32;

/** Follow `parentId` to the thread root. Depth-capped against a cyclic reply. */
function rootOf<T extends CommentRow>(comment: T, byId: Map<string, T>): T {
  let current = comment;
  for (let hops = 0; current.parentId && hops < MAX_THREAD_DEPTH; hops += 1) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

/**
 * Split a page's comments into the ones anchored into the document and the ones
 * that belong under it. A reply inherits its root's kind, so answering an inline
 * comment never drops the reply into the page-wide list.
 */
export function splitComments<T extends CommentRow>(
  comments: readonly T[],
): { inline: T[]; page: T[] } {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const inline: T[] = [];
  const page: T[] = [];
  for (const comment of comments) {
    const root = rootOf(comment, byId);
    if (parseCommentAnchor(root.anchor)) inline.push(comment);
    else page.push(comment);
  }
  return { inline, page };
}

function byCreatedAt(a: CommentRow, b: CommentRow): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Build the rail's threads from the page's comments and the highlight positions
 * currently measured in the document (`markId → px from the top of the content`).
 *
 * Ordering is by position in the document, not by creation time — that is what
 * makes the rail read as a margin. Overlapping anchors therefore land next to
 * each other, both kept, ordered by age within the same position. Orphans have
 * no position and sort last, oldest first.
 *
 * A comment whose root was deleted, or whose anchor is unreadable, is skipped:
 * both are already excluded upstream (the API filters `deletedAt`), and neither
 * can be placed.
 */
export function buildInlineThreads(
  comments: readonly CommentRow[],
  positions: ReadonlyMap<string, number>,
): InlineThread[] {
  const roots = new Map<string, InlineThread>();
  const pending: CommentRow[] = [];

  for (const comment of comments) {
    const anchor = comment.parentId ? null : parseCommentAnchor(comment.anchor);
    if (!anchor) {
      pending.push(comment);
      continue;
    }
    const top = positions.get(anchor.markId);
    roots.set(comment.id, {
      markId: anchor.markId,
      anchor,
      root: comment,
      replies: [],
      resolved: comment.resolvedAt !== null,
      orphaned: top === undefined,
      top: top ?? 0,
    });
  }

  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  for (const reply of pending) {
    const thread = roots.get(rootOf(reply, byId).id);
    if (thread) thread.replies.push(reply);
  }

  const threads = [...roots.values()];
  for (const thread of threads) thread.replies.sort(byCreatedAt);
  threads.sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? 1 : -1;
    if (!a.orphaned && a.top !== b.top) return a.top - b.top;
    return byCreatedAt(a.root, b.root);
  });
  return threads;
}

/** Mark ids the rail knows a thread for — everything else is a stale highlight. */
export function knownMarkIds(threads: readonly InlineThread[]): Set<string> {
  return new Set(threads.map((thread) => thread.markId));
}
