// Reading `@mentions` back out of what was saved. Pure and dependency-free, so
// both shapes the product stores a mention in — the editor's ProseMirror JSON
// and a comment's plain text — are covered by unit tests without a database.

/** A single ProseMirror/TipTap node: may carry attributes and child content. */
type ProseMirrorNode = {
  type?: string;
  attrs?: { id?: unknown };
  content?: ProseMirrorNode[];
};

// Same cap and reasoning as the page-link extractor: legitimate documents nest
// a few dozen levels, hand-crafted JSON inside the body limit can nest tens of
// thousands and overflow the recursive walk's stack.
const MAX_DEPTH = 200;

/**
 * User ids named by `mention` nodes in a page document, in document order and
 * de-duplicated — mentioning someone ten times is still one mention of them.
 * Any non-document input (null, a string, a malformed shape) yields none rather
 * than throwing: a save must not fail because a document could not be scanned.
 */
export function mentionedUserIdsInDocument(content: unknown): string[] {
  const found = new Set<string>();
  walk(content, 0, found);
  return [...found];
}

function walk(node: unknown, depth: number, found: Set<string>): void {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, depth + 1, found);
    return;
  }
  const typed = node as ProseMirrorNode;
  if (typed.type === "mention" && typeof typed.attrs?.id === "string" && typed.attrs.id) {
    found.add(typed.attrs.id);
  }
  if (typed.content) walk(typed.content, depth + 1, found);
}

/** Someone who *could* be named in a plain-text body. */
export type MentionCandidate = { id: string; name: string };

// A name ends where a word does. Names contain spaces ("Ada Lovelace"), so the
// text cannot simply be split on whitespace — the candidate list decides where
// the name stops, and only a non-word character may follow it.
const WORD = /[\p{L}\p{N}_]/u;

/**
 * User ids named by `@Name` in plain text (comment bodies, which are not rich
 * text). Matching is against the supplied candidates only — an `@something`
 * that names nobody is just text, and never a notification.
 *
 * Longest name first, so `@Ada Lovelace` resolves to Ada Lovelace and not to a
 * colleague who happens to be called Ada.
 */
export function mentionedUserIdsInText(text: string, candidates: MentionCandidate[]): string[] {
  if (!text.includes("@") || candidates.length === 0) return [];
  const byLength = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const haystack = text.toLowerCase();
  const found = new Set<string>();

  for (let at = haystack.indexOf("@"); at !== -1; at = haystack.indexOf("@", at + 1)) {
    // `foo@example.com` is an address, not a mention.
    const before = at > 0 ? text[at - 1] : "";
    if (before && WORD.test(before)) continue;
    for (const candidate of byLength) {
      const name = candidate.name.trim().toLowerCase();
      if (!name || !haystack.startsWith(name, at + 1)) continue;
      const after = text[at + 1 + name.length] ?? "";
      if (after && WORD.test(after)) continue;
      found.add(candidate.id);
      break;
    }
  }
  return [...found];
}
