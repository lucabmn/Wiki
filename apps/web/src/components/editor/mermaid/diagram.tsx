import { useEffect, useState } from "react";

import { renderMermaid, type MermaidResult } from "./render";
import {
  CAPTION_CLASS,
  ERROR_CLASS,
  ERROR_MESSAGE_CLASS,
  ERROR_SOURCE_CLASS,
  FIGURE_CLASS,
  PENDING_CLASS,
  SURFACE_CLASS,
} from "./styles";
import { useDarkTheme } from "./theme";

type DiagramState = MermaidResult | "pending";

/**
 * Renders one diagram: a pending placeholder while Mermaid loads (first use
 * only — the library is a dynamic import), the sanitized SVG when it parses,
 * and an inline error plus the source when it does not. Never throws; a broken
 * diagram is a message in the document, not a blank box and not a crashed
 * editor.
 */
export function MermaidDiagramView({
  source,
  caption,
  className,
}: {
  source: string;
  caption?: string | null;
  className?: string;
}) {
  const dark = useDarkTheme();
  const [state, setState] = useState<DiagramState>("pending");

  useEffect(() => {
    let active = true;
    setState("pending");
    void renderMermaid(source, { dark }).then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, [source, dark]);

  return (
    <figure className={className ? `${FIGURE_CLASS} ${className}` : FIGURE_CLASS}>
      {state === "pending" ? (
        <div className={PENDING_CLASS} aria-busy="true">
          Diagramm wird gerendert …
        </div>
      ) : state.error !== null ? (
        <div className={ERROR_CLASS} role="note">
          <p className={ERROR_MESSAGE_CLASS}>Diagramm konnte nicht gerendert werden</p>
          <p>{state.error}</p>
          {source.trim() ? <pre className={ERROR_SOURCE_CLASS}>{source}</pre> : null}
        </div>
      ) : (
        <div
          className={SURFACE_CLASS}
          role="img"
          aria-label={caption?.trim() || "Mermaid-Diagramm"}
          // Safe: `renderMermaid` returns markup that passed the SVG allowlist
          // in `sanitize.ts` — no script, no event handlers, no off-document
          // references. Same line the read view draws for stored links.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
      {caption?.trim() ? <figcaption className={CAPTION_CLASS}>{caption}</figcaption> : null}
    </figure>
  );
}
