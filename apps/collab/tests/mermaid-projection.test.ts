import { TiptapTransformer } from "@hocuspocus/transformer";
import { MERMAID_NODE_NAME, pageEditorExtensions } from "@nilovon-wiki/editor";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

const FIELD = "default";

const withDiagram = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Ablauf" }] },
    {
      type: MERMAID_NODE_NAME,
      attrs: { source: "flowchart TD\n  A[Start] --> B[Ende]", caption: "Freigabe" },
    },
  ],
};

/**
 * The failure this ticket exists to prevent: a diagram node that only the
 * browser knows about. The collab server seeds and projects the shared document
 * with `pageEditorExtensions()` (`src/hocuspocus.ts`), so a node type missing
 * from that schema is silently dropped on the way back to `content` — the
 * diagram would vanish for every other client the moment the server persisted.
 */
describe("Collaborative projection of diagram nodes", () => {
  it("keeps the diagram when a second client syncs and the server projects", () => {
    const author = TiptapTransformer.toYdoc(withDiagram, FIELD, pageEditorExtensions());

    // A second client joins and receives the update, exactly as Hocuspocus
    // relays it; then it echoes its own state back.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(author));
    Y.applyUpdate(author, Y.encodeStateAsUpdate(peer));

    // What the server writes to `page.content` after the debounce.
    const projected = TiptapTransformer.fromYdoc(peer, FIELD);

    expect(projected).toEqual(withDiagram);
  });

  it("carries a diagram inserted by the second client back to the first", () => {
    const author = TiptapTransformer.toYdoc(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Ablauf" }] }],
      },
      FIELD,
      pageEditorExtensions(),
    );
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(author));

    // The second client inserts a diagram into the shared fragment — the same
    // CRDT operation the editor's Collaboration extension performs.
    const inserted = new Y.XmlElement(MERMAID_NODE_NAME);
    inserted.setAttribute("source", "sequenceDiagram\n  A->>B: ok");
    peer.getXmlFragment(FIELD).insert(1, [inserted]);
    Y.applyUpdate(author, Y.encodeStateAsUpdate(peer));

    const projected = TiptapTransformer.fromYdoc(author, FIELD) as {
      content: Array<{ type: string; attrs?: { source?: string } }>;
    };
    const diagram = projected.content.find((node) => node.type === MERMAID_NODE_NAME);

    expect(diagram?.attrs?.source).toContain("sequenceDiagram");
  });
});
