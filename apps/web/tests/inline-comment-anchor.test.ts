import { Editor, generateHTML } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  COMMENT_ANCHOR_VERSION,
  EXCERPT_MAX_LENGTH,
  createCommentAnchor,
  newCommentMarkId,
  parseCommentAnchor,
  toExcerpt,
} from "@nilovon-wiki/editor/comment-anchor";
import { commentMarkIds, commentMarkText } from "@nilovon-wiki/editor/comment-mark";
import { pageEditorExtensions } from "@/components/editor/extensions";

function makeEditor(content: string) {
  return new Editor({ extensions: pageEditorExtensions(), content });
}

describe("comment anchor", () => {
  it("survives serialization to JSON and back unchanged", () => {
    const anchor = createCommentAnchor("mark-1", "  the   runbook\nsection ");
    const roundTripped = parseCommentAnchor(JSON.parse(JSON.stringify(anchor)));
    expect(roundTripped).toEqual(anchor);
    expect(roundTripped?.excerpt).toBe("the runbook section");
  });

  it("clips an oversized excerpt instead of storing a whole paragraph", () => {
    const excerpt = toExcerpt("x".repeat(EXCERPT_MAX_LENGTH * 2));
    expect(excerpt).toHaveLength(EXCERPT_MAX_LENGTH);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("keeps reading a v1 anchor after the format grows", () => {
    // What a later build might write on top of the same version.
    const grown = { v: 1, type: "mark", markId: "m1", excerpt: "quoted", strategy: "hybrid" };
    expect(parseCommentAnchor(grown)).toEqual({
      v: COMMENT_ANCHOR_VERSION,
      type: "mark",
      markId: "m1",
      excerpt: "quoted",
    });
  });

  it("refuses anchors it cannot place rather than guessing a position", () => {
    expect(parseCommentAnchor(null)).toBeNull();
    expect(parseCommentAnchor({ v: 2, type: "relative", markId: "m1" })).toBeNull();
    expect(parseCommentAnchor({ v: 1, type: "mark", markId: "" })).toBeNull();
    expect(parseCommentAnchor([{ v: 1, type: "mark", markId: "m1" }])).toBeNull();
  });

  it("mints distinct mark ids", () => {
    expect(newCommentMarkId()).not.toBe(newCommentMarkId());
  });
});

describe("comment mark", () => {
  it("annotates a selection and serializes into the read-only HTML", () => {
    const editor = makeEditor("<p>See the runbook</p>");
    editor.commands.setTextSelection({ from: 5, to: 16 });
    editor.commands.setCommentMark("m1");

    expect(commentMarkText(editor.state.doc, "m1")).toBe("the runbook");
    // The read view renders stored JSON through the same shared schema — this is
    // the path a reader who never opens the editor takes.
    const html = generateHTML(editor.getJSON() as Record<string, unknown>, pageEditorExtensions());
    expect(html).toContain('data-comment-id="m1"');
    editor.destroy();
  });

  it("keeps both comments when two anchors overlap", () => {
    const editor = makeEditor("<p>alpha beta gamma</p>");
    editor.commands.setTextSelection({ from: 1, to: 11 }); // "alpha beta"
    editor.commands.setCommentMark("m1");
    editor.commands.setTextSelection({ from: 7, to: 17 }); // "beta gamma"
    editor.commands.setCommentMark("m2");

    expect([...commentMarkIds(editor.state.doc)].sort()).toEqual(["m1", "m2"]);
    expect(commentMarkText(editor.state.doc, "m1")).toBe("alpha beta");
    expect(commentMarkText(editor.state.doc, "m2")).toBe("beta gamma");
    editor.destroy();
  });

  it("removes one anchor without disturbing the one it overlaps", () => {
    const editor = makeEditor("<p>alpha beta gamma</p>");
    editor.commands.setTextSelection({ from: 1, to: 11 });
    editor.commands.setCommentMark("m1");
    editor.commands.setTextSelection({ from: 7, to: 17 });
    editor.commands.setCommentMark("m2");

    editor.commands.unsetCommentMark("m1");
    expect([...commentMarkIds(editor.state.doc)]).toEqual(["m2"]);
    expect(commentMarkText(editor.state.doc, "m2")).toBe("beta gamma");
    editor.destroy();
  });

  it("orphans the anchor when the annotated text is deleted", () => {
    const editor = makeEditor("<p>See the runbook</p>");
    editor.commands.setTextSelection({ from: 5, to: 16 });
    editor.commands.setCommentMark("m1");
    editor.commands.deleteRange({ from: 5, to: 16 });

    expect(commentMarkIds(editor.state.doc).has("m1")).toBe(false);
    editor.destroy();
  });

  it("does not grow the annotated range when text is typed at its edge", () => {
    const editor = makeEditor("<p>alpha beta</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setCommentMark("m1");
    editor.commands.insertContentAt(6, "X");

    expect(commentMarkText(editor.state.doc, "m1")).toBe("alpha");
    editor.destroy();
  });
});
