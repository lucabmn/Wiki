import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { commentMarkText } from "@nilovon-wiki/editor/comment-mark";
import { pageEditorExtensions } from "@/components/editor/extensions";

/**
 * The anchor's reason for existing: the page body is a Yjs CRDT, so an absolute
 * `{from, to}` is wrong the moment anyone types above the annotated text.
 *
 * These two clients edit *concurrently* — the updates are exchanged only after
 * both have made their change, which is exactly the case an offset-based anchor
 * gets wrong and a mark inside the document does not.
 */
function makeClient(doc: Y.Doc) {
  return new Editor({
    extensions: [
      ...pageEditorExtensions({ collaborative: true }),
      Collaboration.configure({ document: doc }),
    ],
  });
}

/** Bring `target` up to date with everything `source` knows. */
function sync(source: Y.Doc, target: Y.Doc) {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)));
}

describe("inline anchors under concurrent editing", () => {
  it("still points at the same word after another client inserts text before it", () => {
    const docA = new Y.Doc();
    const clientA = makeClient(docA);
    clientA.commands.setContent("<p>alpha beta gamma</p>");

    const docB = new Y.Doc();
    sync(docA, docB);
    const clientB = makeClient(docB);

    // Concurrent, not sequential: neither client has seen the other's edit yet.
    clientA.commands.setTextSelection({ from: 12, to: 17 }); // "gamma"
    clientA.commands.setCommentMark("m1");
    clientB.commands.insertContentAt(1, "PREFIX ");

    sync(docA, docB);
    sync(docB, docA);

    expect(clientA.getText()).toBe("PREFIX alpha beta gamma");
    expect(clientB.getText()).toBe("PREFIX alpha beta gamma");
    // The word moved seven characters to the right; the anchor moved with it.
    expect(commentMarkText(clientA.state.doc, "m1")).toBe("gamma");
    expect(commentMarkText(clientB.state.doc, "m1")).toBe("gamma");

    clientA.destroy();
    clientB.destroy();
  });

  it("orphans the anchor — and only that anchor — when the other client deletes the text", () => {
    const docA = new Y.Doc();
    const clientA = makeClient(docA);
    clientA.commands.setContent("<p>alpha beta gamma</p>");
    clientA.commands.setTextSelection({ from: 1, to: 6 }); // "alpha"
    clientA.commands.setCommentMark("kept");
    clientA.commands.setTextSelection({ from: 12, to: 17 }); // "gamma"
    clientA.commands.setCommentMark("doomed");

    const docB = new Y.Doc();
    sync(docA, docB);
    const clientB = makeClient(docB);
    clientB.commands.deleteRange({ from: 11, to: 17 }); // " gamma"

    sync(docB, docA);

    expect(clientA.getText()).toBe("alpha beta");
    // Unresolvable: the rail shows this thread against its stored excerpt.
    expect(commentMarkText(clientA.state.doc, "doomed")).toBe("");
    expect(commentMarkText(clientA.state.doc, "kept")).toBe("alpha");

    clientA.destroy();
    clientB.destroy();
  });

  it("keeps both anchors when two clients comment on overlapping ranges at once", () => {
    const docA = new Y.Doc();
    const clientA = makeClient(docA);
    clientA.commands.setContent("<p>alpha beta gamma</p>");

    const docB = new Y.Doc();
    sync(docA, docB);
    const clientB = makeClient(docB);

    clientA.commands.setTextSelection({ from: 1, to: 11 }); // "alpha beta"
    clientA.commands.setCommentMark("m1");
    clientB.commands.setTextSelection({ from: 7, to: 17 }); // "beta gamma"
    clientB.commands.setCommentMark("m2");

    sync(docA, docB);
    sync(docB, docA);

    for (const client of [clientA, clientB]) {
      expect(commentMarkText(client.state.doc, "m1")).toBe("alpha beta");
      expect(commentMarkText(client.state.doc, "m2")).toBe("beta gamma");
    }

    clientA.destroy();
    clientB.destroy();
  });
});
