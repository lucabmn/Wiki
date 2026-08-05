/**
 * The diagram facts that are NOT tied to TipTap: the node name, the input
 * limits, and the ` ```mermaid ` ⇄ node conversion.
 *
 * Deliberately free of `@tiptap/core` so the API import guard
 * (`@nilovon-wiki/api`) and the export serializers (`apps/server`) can share
 * them without dragging a ProseMirror schema into a server bundle. The TipTap
 * node itself lives in `./mermaid`.
 */

/** Node type name — identical in the editor, the collab server, and every export. */
export const MERMAID_NODE_NAME = "mermaidDiagram";

/** The fence info string / code-block language a diagram round-trips through. */
export const MERMAID_LANGUAGE = "mermaid";

/**
 * Upper bound for one diagram's source. Mermaid parses in the browser's main
 * thread, so an unbounded document would let one page freeze every reader's tab;
 * 20k characters is far beyond any hand-written diagram.
 */
export const MERMAID_SOURCE_LIMIT = 20_000;

/** Captions are a one-liner, and they are the only part reaching the search index. */
export const MERMAID_CAPTION_LIMIT = 300;

type DocumentNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocumentNode[];
};

function isMermaidCodeBlock(node: DocumentNode): boolean {
  return (
    node.type === "codeBlock" &&
    String(node.attrs?.language ?? "").toLowerCase() === MERMAID_LANGUAGE
  );
}

/**
 * Turns ` ```mermaid ` fences — which every Markdown/HTML importer lands as a
 * `codeBlock` with `language: "mermaid"` — back into diagram nodes.
 *
 * Without this the export→import round trip is one-way: `documentToMarkdown`
 * writes the de-facto-standard fence, and re-importing it would leave the page
 * with a wall of diagram source instead of a diagram.
 */
export function adoptMermaidCodeBlocks<T>(document: T): T {
  const visit = (node: DocumentNode): DocumentNode => {
    if (isMermaidCodeBlock(node)) {
      return {
        type: MERMAID_NODE_NAME,
        attrs: {
          source: (node.content ?? []).map((child) => child.text ?? "").join(""),
          caption: null,
        },
      };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };

  if (!document || typeof document !== "object" || Array.isArray(document)) return document;
  return visit(document as DocumentNode) as T;
}

/** True when the document holds at least one diagram — drives the export hint. */
export function containsMermaidDiagram(document: unknown): boolean {
  if (!document || typeof document !== "object") return false;
  const node = document as DocumentNode;
  if (node.type === MERMAID_NODE_NAME) return true;
  return (node.content ?? []).some(containsMermaidDiagram);
}
