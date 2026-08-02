import { normalizeExternalUrl } from "@nilovon-wiki/api/lib/external-url";
import { pageIdFromHref } from "@nilovon-wiki/api/lib/page-href";
import { generateHTML } from "@tiptap/core";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useMemo } from "react";

import { pageEditorExtensions } from "./extensions";
import "./editor.css";

/**
 * Rewrites the anchors of a serialized document in place.
 *
 * Internal `/pages/<id>` links lose the `target="_blank"` TipTap's Link
 * extension puts on every anchor: the click handler below routes them
 * client-side, and the attribute would both open a stray tab on a middle-click
 * and earn them the external-link arrow the stylesheet keys off `target`.
 *
 * Everything else is re-validated through the shared external-URL normalizer
 * and marked up for a foreign destination:
 *
 *  - `target="_blank"` so leaving the wiki doesn't lose the reader's place,
 *    with `rel="noopener noreferrer"` (no `window.opener` handle for the target
 *    page, no wiki URLs in its referrer log).
 *  - anything that isn't an http(s) URL loses its href entirely. Document JSON
 *    can reach the database through the API as well as through the editor, so
 *    this render step — not TipTap's input validation — is the last line before
 *    a stored `javascript:` href becomes a live anchor.
 */
function hardenLinks(root: DocumentFragment): void {
  root.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (pageIdFromHref(href)) {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      return;
    }
    // Validate, but keep the href exactly as authored: the normalizer
    // re-serializes through `new URL` (trailing slashes, percent-encoding), and
    // silently rewriting stored content at render time is not this function's
    // job. Links written through the app are already stored normalized.
    if (!href || !normalizeExternalUrl(href)) {
      anchor.removeAttribute("href");
      return;
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
}

function safeStoredColor(value: string): boolean {
  return (
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^rgba?\([\d\s.,%]+\)$/i.test(value) ||
    /^hsla?\([\d\s.,%]+\)$/i.test(value)
  );
}

/** Keep the editor's formatting properties, but drop arbitrary CSS declarations. */
function hardenStyles(root: DocumentFragment): void {
  root.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    const { textAlign, color, backgroundColor } = element.style;
    element.removeAttribute("style");
    if (["left", "center", "right", "justify"].includes(textAlign)) {
      element.style.textAlign = textAlign;
    }
    if (safeStoredColor(color)) element.style.color = color;
    if (safeStoredColor(backgroundColor)) element.style.backgroundColor = backgroundColor;
    if (!element.getAttribute("style")) element.removeAttribute("style");
  });
}

function hardenImages(root: DocumentFragment): void {
  root.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src");
    if (!src || !normalizeExternalUrl(src)) {
      image.removeAttribute("src");
      image.setAttribute("data-unavailable", "true");
    }
    image.removeAttribute("srcset");
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    image.setAttribute("referrerpolicy", "no-referrer");
  });
}

/**
 * Read-only renderer for a stored page document. Serializes the TipTap JSON to
 * HTML once (memoized) rather than mounting a second ProseMirror instance per
 * viewer, and intercepts clicks on internal `/pages/<id>` links so they navigate
 * client-side instead of triggering a full reload. Pages without rich content
 * yet (imported / never edited) fall back to their plain `textContent`;
 * `emptyLabel` overrides the message shown when there is nothing to render
 * (e.g. a draft that has never been published).
 */
export function PageContent({
  content,
  fallbackText,
  emptyLabel = "Diese Seite hat noch keinen Inhalt.",
}: {
  content: unknown;
  fallbackText: string;
  emptyLabel?: string;
}) {
  const navigate = useNavigate();

  const html = useMemo(() => {
    if (!content || typeof content !== "object") return null;
    try {
      const raw = generateHTML(content as Record<string, unknown>, pageEditorExtensions());
      // Tag headings with positional ids (heading-0, heading-1, …) so the TOC
      // can scroll to them. Order matches extractHeadings().
      const template = document.createElement("template");
      template.innerHTML = raw;
      template.content.querySelectorAll("h1, h2, h3").forEach((heading, index) => {
        heading.id = `heading-${index}`;
      });
      hardenLinks(template.content);
      hardenImages(template.content);
      hardenStyles(template.content);
      return template.innerHTML;
    } catch {
      return null;
    }
  }, [content]);

  if (html === null) {
    const text = fallbackText.trim();
    return text ? (
      <div className="tiptap whitespace-pre-wrap">{text}</div>
    ) : (
      <p className="text-muted-foreground">{emptyLabel}</p>
    );
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const pageId = pageIdFromHref(anchor.getAttribute("href"));
    if (pageId) {
      event.preventDefault();
      navigate({ to: "/pages/$id", params: { id: pageId } });
    }
  };

  // Safe: the HTML is produced by TipTap's serializer from a fixed schema —
  // unknown nodes/marks are dropped, so no user-authored markup survives — and
  // `hardenLinks`, `hardenImages`, and `hardenStyles` validate the attributes
  // the schema can carry into HTML.
  return (
    <div className="tiptap" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
