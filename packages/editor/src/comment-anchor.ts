/**
 * The anchor payload for inline comments — the opaque JSON the API stores in
 * `comment.anchor`. The server never interprets it (see
 * `packages/api/src/routers/comment.ts`); this module is the only place that
 * knows its shape, and it is shared with the collab server through
 * `@nilovon-wiki/editor` so both halves agree on it.
 *
 * ## Decision: document mark, not Yjs relative position
 *
 * The page body is a Yjs CRDT, so an absolute `{from, to}` is wrong the moment
 * anyone types above the annotated text. Of the two workable strategies, this
 * anchor names a **mark inside the document** (`comment-mark.ts`) rather than a
 * serialized `Y.RelativePosition`:
 *
 *  1. The read-only view (`page-content.tsx`) renders the *published* JSON with
 *     `generateHTML` and has no Yjs document at all. A relative position is
 *     unresolvable there — and "most readers never open the editor" is exactly
 *     the case inline comments exist for. A mark ships with the document and
 *     serializes into the HTML for free.
 *  2. A mark survives concurrent editing by construction: it is part of the
 *     CRDT, so Yjs moves it with its text instead of us re-deriving an offset.
 *  3. It is a single source of truth. Two mechanisms (mark for display,
 *     relative position for truth) can disagree; one cannot.
 *
 * The price is that deleting the annotated text deletes the anchor, and that a
 * comment made while editing looks unanchored to readers until the page is
 * published. Both land in the same, deliberately non-destructive place: the
 * comment stays, and the rail shows it as *orphaned* next to the text it was
 * originally made on — which is why `excerpt` is captured at creation time and
 * stored here rather than derived later.
 *
 * The format is versioned. `parseCommentAnchor` accepts every shape it knows
 * and rejects the rest, so anchors already in the database keep resolving when
 * the format grows: add a `CommentAnchorV2`, keep the v1 branch.
 */

export const COMMENT_ANCHOR_VERSION = 1;

/** Upper bound on the quoted text kept with the anchor. */
export const EXCERPT_MAX_LENGTH = 180;

export type CommentAnchorV1 = {
  v: 1;
  /** Anchor strategy. Discriminates v1 from any later strategy at the same `v`. */
  type: "mark";
  /** Id of the `comment` mark in the document this comment is attached to. */
  markId: string;
  /** The annotated text as it read when the comment was made. */
  excerpt: string;
};

export type CommentAnchor = CommentAnchorV1;

/** Collapse whitespace and clip to `EXCERPT_MAX_LENGTH`, ellipsis included. */
export function toExcerpt(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > EXCERPT_MAX_LENGTH ? `${flat.slice(0, EXCERPT_MAX_LENGTH - 1)}…` : flat;
}

export function createCommentAnchor(markId: string, excerpt: string): CommentAnchorV1 {
  return { v: COMMENT_ANCHOR_VERSION, type: "mark", markId, excerpt: toExcerpt(excerpt) };
}

/**
 * Read a stored anchor. Returns `null` for a page-wide comment (`anchor` is
 * null), for a malformed one, and for a version this build does not know — a
 * caller must never guess a position from a payload it cannot read.
 *
 * Unknown *extra* fields are ignored rather than rejected: a v1 anchor written
 * by an older client stays readable after the format grows.
 */
export function parseCommentAnchor(value: unknown): CommentAnchor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1 || raw.type !== "mark") return null;
  if (typeof raw.markId !== "string" || raw.markId.length === 0) return null;
  return {
    v: 1,
    type: "mark",
    markId: raw.markId,
    excerpt: typeof raw.excerpt === "string" ? raw.excerpt : "",
  };
}

/** True when the comment is anchored into the document rather than the page. */
export function isInlineAnchor(value: unknown): boolean {
  return parseCommentAnchor(value) !== null;
}

/**
 * A fresh mark id. Generated on the client because the mark goes into the
 * shared document *before* the comment row exists — the id is what ties the two
 * together afterwards.
 */
export function newCommentMarkId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = webCrypto?.randomUUID?.();
  if (uuid) return uuid;
  // Non-secure fallback for environments without WebCrypto; collision risk is
  // irrelevant here (ids are scoped to one document).
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
