import { MERMAID_NODE_NAME } from "@nilovon-wiki/editor/mermaid-document";
import { useEffect, type RefObject } from "react";

import { renderMermaid } from "./render";
import {
  CAPTION_CLASS,
  ERROR_CLASS,
  ERROR_MESSAGE_CLASS,
  FIGURE_CLASS,
  PENDING_CLASS,
  SURFACE_CLASS,
} from "./styles";
import { useDarkTheme } from "./theme";

const FIGURE_MARKER = "data-mermaid-figure";

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paint(figure: HTMLElement, svg: string | null, error: string | null, caption: string) {
  figure.textContent = "";
  if (svg === null) {
    const box = element("div", ERROR_CLASS);
    box.setAttribute("role", "note");
    box.append(
      element("p", ERROR_MESSAGE_CLASS, "Diagramm konnte nicht gerendert werden"),
      element("p", "", error ?? ""),
    );
    figure.append(box);
    return;
  }
  const surface = element("div", SURFACE_CLASS);
  surface.setAttribute("role", "img");
  surface.setAttribute("aria-label", caption || "Mermaid-Diagramm");
  // Safe: `renderMermaid` only ever returns markup that passed the SVG
  // allowlist in `sanitize.ts` — the same guarantee the React node view relies
  // on, and the same line `page-content.tsx` draws for stored links.
  surface.innerHTML = svg;
  figure.append(surface);
  if (caption) figure.append(element("figcaption", CAPTION_CLASS, caption));
}

/**
 * Renders the diagrams inside already-serialized page HTML.
 *
 * The read view hands ProseMirror's output to `dangerouslySetInnerHTML` instead
 * of mounting a second editor, so there is no node view to hook into: this walks
 * the container, hides each `<pre class="mermaid">` (it stays in the DOM as the
 * source of truth — copy, view-source and re-renders all read it back) and puts
 * a rendered figure in front of it. Idempotent, so a theme switch or a new
 * revision preview simply repaints.
 */
export function useMermaidReadView(
  container: RefObject<HTMLElement | null>,
  html: string | null,
): void {
  const dark = useDarkTheme();

  useEffect(() => {
    const root = container.current;
    if (!root || html === null) return;
    let active = true;

    const sources = root.querySelectorAll<HTMLElement>(`pre[data-type="${MERMAID_NODE_NAME}"]`);
    const figures: HTMLElement[] = [];
    for (const pre of sources) {
      const previous = pre.previousElementSibling;
      if (previous?.hasAttribute(FIGURE_MARKER)) previous.remove();

      const figure = element("figure", FIGURE_CLASS);
      figure.setAttribute(FIGURE_MARKER, "true");
      figure.append(element("div", PENDING_CLASS, "Diagramm wird gerendert …"));
      pre.hidden = true;
      pre.before(figure);
      figures.push(figure);

      const caption = pre.getAttribute("data-caption")?.trim() ?? "";
      void renderMermaid(pre.textContent ?? "", { dark }).then(({ svg, error }) => {
        if (active && figure.isConnected) paint(figure, svg, error, caption);
      });
    }

    return () => {
      active = false;
      // React owns this container's markup; only the nodes added here are
      // removed, and the untouched `<pre>` is unhidden for the next pass.
      for (const figure of figures) {
        const pre = figure.nextElementSibling;
        if (pre instanceof HTMLElement) pre.hidden = false;
        figure.remove();
      }
    };
  }, [container, html, dark]);
}
