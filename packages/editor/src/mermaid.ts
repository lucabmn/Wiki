import { mergeAttributes, Node } from "@tiptap/core";

import { MERMAID_LANGUAGE, MERMAID_NODE_NAME } from "./mermaid-document";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaidDiagram: {
      /** Inserts a diagram block at the selection. */
      insertMermaidDiagram: (attributes?: {
        source?: string;
        caption?: string | null;
      }) => ReturnType;
    };
  }
}

/**
 * The bit of an element `parseHTML` needs. Spelled out structurally because
 * this package compiles without the DOM lib — it has to load in the collab
 * server's Node process, and the parse rules only ever run in a browser.
 */
type ParsedElement = {
  getAttribute(name: string): string | null;
  classList: { contains(token: string): boolean };
  textContent: string | null;
  querySelector(selectors: string): ParsedElement | null;
};

/**
 * Reads the Mermaid source out of the two HTML shapes we accept:
 * our own `<pre class="mermaid">` output and the ` ```mermaid ` fence as every
 * Markdown renderer emits it (`<pre><code class="language-mermaid">`). Returns
 * `null` for anything else, which keeps ordinary `<pre>` blocks code blocks.
 */
function mermaidSource(element: ParsedElement): string | null {
  if (
    element.getAttribute("data-type") === MERMAID_NODE_NAME ||
    element.classList.contains(MERMAID_LANGUAGE)
  ) {
    return element.textContent ?? "";
  }
  const code = element.querySelector("code");
  return code?.classList.contains(`language-${MERMAID_LANGUAGE}`) ? (code.textContent ?? "") : null;
}

/**
 * Diagram block — the Mermaid source lives in the document as text, so it is
 * versioned, diffable and searchable-by-caption instead of being an opaque
 * uploaded image.
 *
 * This is the SPEC only: no React, no Mermaid import, nothing that needs a DOM
 * beyond ProseMirror's own serializer. It has to load in the collab server's
 * Node process (`apps/collab`), which projects the Yjs document back to
 * `content`/`textContent` against exactly this schema — a browser-only node type
 * would be dropped there and the diagram would vanish for everyone else. The
 * rendering half is a node view added in `apps/web`
 * (`pageEditorExtensions({ mermaidNodeView })`), the same split the mention node
 * uses for its suggestion popup.
 */
export const MermaidDiagram = Node.create({
  name: MERMAID_NODE_NAME,
  group: "block",
  atom: true,
  // No `draggable`: the node view holds a textarea, and TipTap's drag handling
  // on the whole wrapper would swallow text selection inside it.
  selectable: true,

  addAttributes() {
    return {
      // Serialized as the element's text (see `renderHTML`), not as an
      // attribute — that is what makes the output a `<pre class="mermaid">`
      // block every Mermaid viewer already understands.
      source: { default: "", renderHTML: () => ({}) },
      caption: {
        default: null,
        renderHTML: (attributes) =>
          attributes.caption ? { "data-caption": String(attributes.caption) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        // Above StarterKit's `<pre>` → codeBlock rule (priority 50): a mermaid
        // pre is a diagram, every other one stays a code block.
        tag: "pre",
        priority: 60,
        getAttrs: (element) => {
          const source = mermaidSource(element);
          return source === null
            ? false
            : { source, caption: element.getAttribute("data-caption") || null };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Deterministic and dependency-free — export and SSR hang off this shape,
    // and `parseHTML` above reads it back unchanged.
    return [
      "pre",
      mergeAttributes(HTMLAttributes, { "data-type": MERMAID_NODE_NAME, class: MERMAID_LANGUAGE }),
      String(node.attrs.source ?? ""),
    ];
  },

  renderText({ node }) {
    // The caption, never the source. `renderText` feeds `textContent` and with
    // it the full-text index: emitting the source would make every diagram in
    // the instance a hit for "graph", "flowchart" or any node label.
    return typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  },

  addCommands() {
    return {
      insertMermaidDiagram:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: MERMAID_NODE_NAME,
            attrs: { source: attributes?.source ?? "", caption: attributes?.caption ?? null },
          }),
    };
  },
});
