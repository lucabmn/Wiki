/**
 * SVG allowlist sanitizer for Mermaid output.
 *
 * Mermaid turns user-authored text into markup, and in a wiki every user's
 * content is shown to every other user — so this is an XSS path, not a
 * formatting detail. Mermaid itself runs with `securityLevel: "strict"` and
 * `htmlLabels: false` (see `render.ts`), which is the first line; this is the
 * second, on the same principle the read view applies to links
 * (`page-content.tsx`): anything that could execute loses its teeth before the
 * markup reaches the DOM. Unknown elements are dropped whole, event handlers
 * and off-document references are stripped, and no `<script>`/`<foreignObject>`
 * survives — a diagram is only ever shapes and text.
 */

/** Everything Mermaid emits with HTML labels turned off, and nothing else. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "desc",
  "title",
  "style",
  "marker",
  "symbol",
  "use",
  "clippath",
  "mask",
  "pattern",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textpath",
  "lineargradient",
  "radialgradient",
  "stop",
]);

/** `url(#id)` points inside the diagram; anything else can leave the page. */
const UNSAFE_VALUE = /javascript:|expression\(|url\(\s*(?!['"]?#)/i;

/** Only same-document fragments — no `javascript:`, no remote fetches. */
const FRAGMENT_REFERENCE = /^#[\w.:-]*$/;

const REFERENCE_ATTRIBUTES = new Set(["href", "src", "from", "to", "values", "begin"]);

function isSafeAttribute(name: string, value: string): boolean {
  const attribute = name.toLowerCase();
  if (attribute.startsWith("on")) return false;
  // `localName` collapses `xlink:href` onto `href`, so both are covered.
  if (REFERENCE_ATTRIBUTES.has(attribute)) return FRAGMENT_REFERENCE.test(value.trim());
  return !UNSAFE_VALUE.test(value);
}

/**
 * Mermaid ships the diagram's theme as a `<style>` block inside the SVG, and
 * `classDef` lets an author add to it. CSS can't execute here, but it can reach
 * off the page (`@import`, remote `url()`), so a stylesheet that tries is
 * dropped entirely rather than half-cleaned.
 */
function safeStyleSheet(css: string): string {
  return UNSAFE_VALUE.test(css) || /@import|<|behavior\s*:/i.test(css) ? "" : css;
}

function scrub(element: Element): void {
  // `Array.from` on both live collections: removing while iterating them
  // directly would skip every second entry.
  for (const attribute of Array.from(element.attributes)) {
    if (!isSafeAttribute(attribute.localName, attribute.value)) {
      element.removeAttributeNode(attribute);
    }
  }
  if (element.localName.toLowerCase() === "style") {
    element.textContent = safeStyleSheet(element.textContent ?? "");
    return;
  }
  for (const child of Array.from(element.children)) {
    if (ALLOWED_ELEMENTS.has(child.localName.toLowerCase())) scrub(child);
    else child.remove();
  }
}

/**
 * Returns sanitized SVG markup, or `null` when the input is not a parseable SVG
 * document — callers show their error state instead of injecting anything.
 */
export function sanitizeSvg(markup: string): string | null {
  // Parsed as XML into an inert document: nothing loads, nothing runs, and the
  // result is a tree we can walk rather than a string we'd have to regex.
  // Deliberately no HTML-parser fallback for markup that fails here — sanitizing
  // with one parser and rendering with another is exactly the mismatch mutation
  // XSS lives in. Unparseable output becomes the caller's error state instead.
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    !root ||
    root.localName.toLowerCase() !== "svg" ||
    parsed.getElementsByTagName("parsererror").length > 0
  ) {
    return null;
  }
  scrub(root);
  // Fill the available width instead of Mermaid's intrinsic pixel size.
  root.removeAttribute("width");
  root.setAttribute("style", "max-width:100%;height:auto");
  return new XMLSerializer().serializeToString(root);
}
