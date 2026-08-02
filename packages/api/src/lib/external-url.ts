// External-link contract — the single source of truth for what counts as a
// storable outbound URL, shared by the API (which validates before writing a
// `pageExternalLink` row) and the web editor's "Externer Link" dialog (which
// validates before writing a TipTap `link` mark). Like `page-href.ts` this
// module is intentionally dependency-free so the web bundle can import it
// without pulling in the data layer.
//
// Scope note: links typed directly into the page *body* also pass through
// TipTap's own URI validation. This helper governs everything the app builds a
// href from itself — the curated per-page link list and the toolbar dialog.

/**
 * Only these two schemes may ever reach an `href`. An allowlist, not a
 * blocklist: `javascript:`, `data:`, `vbscript:` and `file:` are the known
 * dangerous ones, but blocking by name loses to the next scheme someone invents
 * (and to `\tj\na\tvascript:` style obfuscation, which `new URL` normalizes away
 * before a blocklist would ever see it).
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Browsers cap URLs well below this; the limit exists so an oversized string
 * can't be parked in the database or blow up a rendered list.
 */
export const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * Normalizes a user-supplied external URL, or returns `null` if it is not one
 * we are willing to link to.
 *
 * Accepts input the way people actually type it — `example.com/docs` gets an
 * `https://` prefix — then re-serializes through the URL parser so what is
 * stored is exactly what a browser would resolve. Embedded credentials
 * (`https://user:pw@host`) are dropped: they would leak into every rendered
 * anchor, the page's HTML export, and the audit trail.
 */
export function normalizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_EXTERNAL_URL_LENGTH) return null;

  // A protocol-relative "//evil.com" inherits the app's own scheme and would
  // parse as a valid URL below — but nobody types it deliberately, and it reads
  // as a path. Reject rather than guess.
  if (trimmed.startsWith("//")) return null;

  // No scheme at all is the common case for hand-typed URLs. Only assume one
  // when the string doesn't already carry something that looks like a scheme,
  // so "javascript:alert(1)" stays rejected instead of becoming
  // "https://javascript:alert(1)".
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // `new URL("https://")` throws, but "https://?x" style inputs can parse with
  // an empty host and would render as a dead link.
  if (!url.hostname) return null;

  url.username = "";
  url.password = "";

  const normalized = url.toString();
  return normalized.length > MAX_EXTERNAL_URL_LENGTH ? null : normalized;
}

/**
 * The host shown as a link's subtitle — `www.` dropped, since it is noise in a
 * list where every row is a different site. Falls back to the raw input for
 * anything unparseable so a display helper never throws.
 */
export function externalUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
