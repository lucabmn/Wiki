import { Editor, generateHTML, generateText } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { pageEditorExtensions } from "@/components/editor/extensions";

/**
 * Headless checks that the shared extension set actually supports the new marks
 * and nodes AND round-trips them through the read-view serializer (generateHTML)
 * — the path the mocked component tests can't exercise.
 */
function makeEditor(content: string) {
  return new Editor({ extensions: pageEditorExtensions(), content });
}

function html(editor: Editor) {
  return generateHTML(editor.getJSON() as Record<string, unknown>, pageEditorExtensions());
}

describe("editor extensions round-trip", () => {
  it("applies and renders a text color", () => {
    const editor = makeEditor("<p>hello</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setColor("#dc2626");
    // The style serializer normalizes the hex to rgb().
    expect(html(editor)).toContain("color: rgb(220, 38, 38)");
    editor.destroy();
  });

  it("applies and renders a highlight", () => {
    const editor = makeEditor("<p>hello</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.toggleHighlight({ color: "#fef08a" });
    const out = html(editor);
    expect(out).toContain("<mark");
    expect(out).toContain("#fef08a");
    editor.destroy();
  });

  it("applies and renders text alignment", () => {
    const editor = makeEditor("<p>hello</p>");
    editor.commands.setTextAlign("center");
    expect(html(editor)).toContain("text-align: center");
    editor.destroy();
  });

  it("supports superscript and subscript", () => {
    const editor = makeEditor("<p>x</p>");
    editor.commands.setTextSelection({ from: 1, to: 2 });
    editor.commands.toggleSuperscript();
    expect(html(editor)).toContain("<sup");
    editor.destroy();
  });

  it("inserts a table that survives serialization", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    const out = html(editor);
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    // Table cell text still flows into the plain-text search field.
    expect(
      typeof generateText(editor.getJSON() as Record<string, unknown>, pageEditorExtensions()),
    ).toBe("string");
    editor.destroy();
  });
});
