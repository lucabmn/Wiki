import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Mention, { type MentionOptions } from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";

import { CommentMark } from "./comment-mark";
import { MermaidDiagram } from "./mermaid";

export * from "./comment-anchor";
export * from "./comment-mark";
export * from "./mermaid";
export * from "./mermaid-document";

/**
 * The single TipTap schema used everywhere a page document is touched — the
 * editable editor, the read-only renderer, AND the headless collaboration
 * server (`apps/collab`). They MUST share this exact set:
 * `generateHTML`/`generateText` and Yjs CRDT sync reproduce a document
 * faithfully only against the same schema (nodes + marks + node attributes like
 * TextAlign's) that produced it — a mismatch between the collab server and the
 * browser corrupts the shared document. Internal page links ride the bundled
 * `link` mark (href `/pages/<id>`, see `@nilovon-wiki/api/lib/page-href`);
 * `openOnClick` is off so the viewer can intercept them for client-side
 * navigation.
 *
 * This module is deliberately headless (no React, no CSS, no editor-only UI
 * extensions such as the slash-command menu) so the Node collab service can
 * import it without a DOM.
 */
export function pageEditorExtensions(options?: {
  placeholder?: string;
  /**
   * Disable StarterKit's built-in undo/redo. Required in the browser when the
   * TipTap `Collaboration` extension is active — it ships its own Yjs-backed
   * history, and running both corrupts the shared undo stack. Leaves the schema
   * untouched (undo/redo contributes no nodes or marks), so the renderer and the
   * collab server can keep the default.
   */
  collaborative?: boolean;
  /**
   * Browser-only `@mention` autocomplete config (items + render popup). The
   * `mention` NODE itself is always in the schema — it must be identical across
   * the editor, the read-only renderer, and the collab server, or Yjs sync and
   * serialization break. The suggestion behaviour (async user lookup, popup) is
   * inert on the server/renderer, which never pass it.
   */
  mention?: Partial<MentionOptions["suggestion"]>;
  /**
   * Browser-only renderer for the diagram node. The NODE is always in the
   * schema — the collab server has to know it, or it drops every diagram when
   * it projects the Yjs document back to `content`. Only the view that turns
   * the source into an SVG (and lazy-loads Mermaid) is passed in here, by
   * `apps/web`; the server and the read-only renderer never do.
   */
  mermaidNodeView?: NodeViewRenderer;
}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      undoRedo: options?.collaborative ? false : undefined,
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 decoration-primary/40",
        },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({
      inline: true,
      allowBase64: false,
      HTMLAttributes: { loading: "lazy", decoding: "async" },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Superscript,
    Subscript,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    // Inline-comment anchor. Like the mention node it is unconditionally part
    // of the schema: the collab server drops marks it doesn't know when it
    // projects the Yjs document into `page.content`, and the read-only renderer
    // needs it to serialize the highlight readers click on.
    CommentMark,
    // `@mention` node. `renderText` feeds the plaintext search projection and the
    // collab server's `textContent`, so a mention reads as "@Name" everywhere.
    Mention.configure({
      HTMLAttributes: { class: "mention" },
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      ...(options?.mention ? { suggestion: options.mention as MentionOptions["suggestion"] } : {}),
    }),
    options?.mermaidNodeView
      ? MermaidDiagram.extend({ addNodeView: () => options.mermaidNodeView! })
      : MermaidDiagram,
    Placeholder.configure({
      placeholder: options?.placeholder ?? 'Schreibe etwas, oder tippe "/" für Befehle …',
      emptyEditorClass:
        "before:pointer-events-none before:float-left before:h-0 before:text-muted-foreground before:content-[attr(data-placeholder)]",
    }),
  ];
}
