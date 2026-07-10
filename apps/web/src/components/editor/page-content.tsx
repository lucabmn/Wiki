import { pageIdFromHref } from "@nilovon-wiki/api/lib/page-href";
import { generateHTML } from "@tiptap/core";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useMemo } from "react";

import { pageEditorExtensions } from "./extensions";
import "./editor.css";

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
  // unknown nodes/marks are dropped, so no user-authored markup survives.
  return (
    <div className="tiptap" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
