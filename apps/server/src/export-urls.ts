/**
 * Link rewriting for exports.
 *
 * Inside an archive, links between exported pages become relative file paths so
 * the unpacked export stays navigable offline — that holds for PDF too, where
 * the target is the sibling `content.pdf`. A single-page export has no siblings,
 * so its internal links point back at the live app instead.
 */

export function resolveArchiveUrl(
  url: string,
  pagePaths: Map<string, string>,
  attachmentPaths: Map<string, string>,
): string {
  const attachmentMatch = /^\/attachments\/([^/?#]+)\/(?:inline|download)(?:[?#].*)?$/.exec(url);
  const attachmentId = attachmentMatch?.[1] ? safeDecodeURIComponent(attachmentMatch[1]) : null;
  const attachmentPath = attachmentId ? attachmentPaths.get(attachmentId) : null;
  if (attachmentPath) return `../../${attachmentPath}`;

  const pageMatch = /^\/pages\/([^/?#]+)([?#].*)?$/.exec(url);
  const pageId = pageMatch?.[1] ? safeDecodeURIComponent(pageMatch[1]) : null;
  const pagePath = pageId ? pagePaths.get(pageId) : null;
  if (pagePath) return `../${pagePath.slice("pages/".length)}${pageMatch?.[2] ?? ""}`;
  return safePortableUrl(url);
}

/**
 * Absolutizes an app-internal link against the web app's origin. Used by the
 * single-page export, whose PDF has no neighbouring files to point at.
 */
export function resolveLiveUrl(url: string, origin: string): string {
  const value = safePortableUrl(url);
  if (!value.startsWith("/")) return value;
  return `${origin.replace(/\/$/, "")}${value}`;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function safePortableUrl(url: string): string {
  const value = url.trim();
  if (!value) return "#";
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return "#";
  if (
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  )
    return "#";
  return value;
}
