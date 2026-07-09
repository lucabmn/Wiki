import { pageHref, pageIdFromHref } from "@nilovon-wiki/api/lib/page-href";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { pageEditorExtensions } from "@/components/editor/extensions";

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
