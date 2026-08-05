// Content rules for applying a page template. Kept out of the router so the
// copy semantics — what survives into the generated page and what does not —
// are readable and unit-testable in one place.

/** How much of a template's body the picker preview carries. */
const EXCERPT_LENGTH = 180;

/** The URL shape the server serves attachment bytes under (see `attachment` routes). */
const ATTACHMENT_URL = /\/attachments\/[^/]+\/(?:inline|download)(?:[?#]|$)/;

export function isAttachmentUrl(value: string): boolean {
  return ATTACHMENT_URL.test(value);
}

/**
 * A one-line preview of a template's body for the picker. Whitespace is
 * collapsed because the plaintext projection keeps the document's line breaks,
 * which would otherwise blow up a card to arbitrary height.
 */
export function templateExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > EXCERPT_LENGTH
    ? `${normalized.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : normalized;
}

function attrsOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const attrs = (value as Record<string, unknown>).attrs;
  return attrs && typeof attrs === "object" && !Array.isArray(attrs)
    ? (attrs as Record<string, unknown>)
    : null;
}

function referencesAttachment(value: unknown, key: "src" | "href"): boolean {
  const target = attrsOf(value)?.[key];
  return typeof target === "string" && isAttachmentUrl(target);
}

/**
 * Drops every attachment reference from a document copied out of a template.
 *
 * A template's images and file links are `attachment` rows owned by the
 * template page. Copying the JSON verbatim would leave every generated page
 * pointing at the template's attachments: deleting the template would break all
 * of them at once, and the bytes would still be gated by the template's ACL
 * rather than the new page's. The alternative — duplicating the blobs per
 * generated page — costs a storage round-trip and a full second copy of every
 * image, which is a lot of machinery for a feature whose job is handing out a
 * structure. So the references go instead: image nodes disappear, a file link
 * keeps its text and loses its href.
 */
export function stripAttachmentReferences(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripAttachmentReferences(item)).filter((item) => item !== null);
  }
  if (!value || typeof value !== "object") return value;

  if (referencesAttachment(value, "src")) return null;
  const node = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...node };
  if (Array.isArray(node.marks)) {
    next.marks = node.marks.filter((mark) => !referencesAttachment(mark, "href"));
  }
  if (Array.isArray(node.content)) {
    next.content = node.content
      .map((child) => stripAttachmentReferences(child))
      .filter((child) => child !== null);
  }
  return next;
}
