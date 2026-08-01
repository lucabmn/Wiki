import { normalizeExternalUrl } from "@nilovon-wiki/api/lib/external-url";
import { pageHref, pageIdFromHref } from "@nilovon-wiki/api/lib/page-href";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { pageEditorExtensions } from "@/components/editor/extensions";
import { applyLink, removeLink } from "@/components/editor/link-commands";

/** Walks a TipTap doc for the first `link` mark href (mirrors extractPageLinks). */
function firstLinkHref(json: Record<string, unknown>): string | null {
  let found: string | null = null;
  const visit = (node: Record<string, unknown> | null | undefined) => {
    if (!node || typeof node !== "object" || found) return;
    const marks = node.marks as Array<{ type?: string; attrs?: { href?: string } }> | undefined;
    if (Array.isArray(marks)) {
      for (const mark of marks) {
        if (mark?.type === "link" && mark.attrs?.href) {
          found = mark.attrs.href;
          return;
        }
      }
    }
    const content = node.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) content.forEach(visit);
  };
  visit(json);
  return found;
}

describe("internal link contract (write path)", () => {
  it("TipTap stores a rooted /pages/<id> href without mangling it", () => {
    // If the Link extension's URI validation dropped or rewrote this href, the
    // backlink contract would silently no-op — this asserts it survives.
    const editor = new Editor({
      extensions: pageEditorExtensions(),
      content: "<p>hello world</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setLink({ href: pageHref("page-123") });

    const href = firstLinkHref(editor.getJSON() as Record<string, unknown>);
    editor.destroy();

    expect(href).toBe("/pages/page-123");
    expect(pageIdFromHref(href)).toBe("page-123");
  });
});

describe("external link contract (write path)", () => {
  it("stores a normalized https href on the selected text", () => {
    const editor = new Editor({
      extensions: pageEditorExtensions(),
      content: "<p>hello world</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    // What the toolbar dialog hands to `applyLink` is always normalizer output.
    const href = normalizeExternalUrl("example.com/docs")!;
    applyLink(editor, { href, text: "unused while text is selected" });

    const json = editor.getJSON() as Record<string, unknown>;
    editor.destroy();
    expect(firstLinkHref(json)).toBe("https://example.com/docs");
  });

  it("inserts the link text when nothing is selected", () => {
    const editor = new Editor({ extensions: pageEditorExtensions(), content: "<p></p>" });
    applyLink(editor, { href: "https://example.com/", text: "example.com" });

    const html = editor.getHTML();
    const href = firstLinkHref(editor.getJSON() as Record<string, unknown>);
    editor.destroy();
    expect(href).toBe("https://example.com/");
    expect(html).toContain("example.com");
  });

  it("inserts at the caret even after the editor lost focus to a dialog", () => {
    // Both link entry points open a dialog first, so by the time `applyLink`
    // runs the DOM focus has left the editor. ProseMirror keeps the selection
    // in editor state, and `.focus()` restores it — this pins that down, since
    // the failure mode (inserting at position 0) is silent.
    const editor = new Editor({ extensions: pageEditorExtensions(), content: "<p>abcdef</p>" });
    editor.commands.setTextSelection(4);
    editor.commands.blur();
    applyLink(editor, { href: "https://example.com/", text: "LINK" });

    const text = editor.getText();
    editor.destroy();
    expect(text).toBe("abcLINKdef");
  });

  it("removes a link while keeping its text", () => {
    const editor = new Editor({ extensions: pageEditorExtensions(), content: "<p>hello</p>" });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLink(editor, { href: "https://example.com/", text: "hello" });
    // The caret merely sits inside the link — `extendMarkRange` is what makes
    // this remove the whole thing rather than nothing.
    editor.commands.setTextSelection({ from: 3, to: 3 });
    removeLink(editor);

    const json = editor.getJSON() as Record<string, unknown>;
    const text = editor.getText();
    editor.destroy();
    expect(firstLinkHref(json)).toBeNull();
    expect(text).toBe("hello");
  });
});
