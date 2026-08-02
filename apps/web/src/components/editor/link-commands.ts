import type { Editor } from "@tiptap/core";

/**
 * Link editing shared by the toolbar's link menu and the slash menu, so both
 * entry points behave identically.
 *
 * Two cases, because a link needs both a target and something to click:
 *  - text is selected → mark the whole existing link/selection with the href
 *  - nothing selected → insert `text` and mark that
 *
 * `extendMarkRange` is what makes editing an existing link work: with the caret
 * merely *inside* a link, the selection is empty but the intent is to retarget
 * the whole link, not to nest a second one.
 */
export function applyLink(editor: Editor, { href, text }: { href: string; text: string }): void {
  if (editor.state.selection.empty && !editor.isActive("link")) {
    editor
      .chain()
      .focus()
      .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
      // Drop the stored mark so typing on after the link isn't swallowed by it.
      .unsetMark("link")
      .run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

/** Removes the link around the caret, keeping its text. */
export function removeLink(editor: Editor): void {
  editor.chain().focus().extendMarkRange("link").unsetLink().run();
}

/** The href of the link the caret sits in, or `null` outside one. */
export function activeLinkHref(editor: Editor): string | null {
  const href: unknown = editor.getAttributes("link").href;
  return typeof href === "string" && href ? href : null;
}
