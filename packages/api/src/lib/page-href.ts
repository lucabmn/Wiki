// Internal page-link contract — the single source of truth shared by the web
// editor (which writes the link href) and the server-side link extractor (which
// reads it back). An internal link is a TipTap `link` mark whose href is
// `/pages/<pageId>`. This module is intentionally dependency-free (no db, no
// drizzle) so the web bundle can import it without pulling the data layer in.

/** Builds the href an internal page link carries. */
export function pageHref(pageId: string): string {
  return `/pages/${pageId}`;
}

// A page href is exactly `/pages/<id>` with no trailing path, query, or hash —
// anything else (an external URL, a deep link) is treated as a normal link and
// does not register as a backlink.
const PAGE_HREF = /^\/pages\/([^/?#]+)$/;

/** Returns the target page id if `href` is an internal page link, else null. */
export function pageIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = PAGE_HREF.exec(href);
  return match?.[1] ?? null;
}
