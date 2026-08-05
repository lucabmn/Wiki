import type { Editor } from "@tiptap/core";
import { MessageSquarePlus } from "lucide-react";
import { useEffect, useState } from "react";

type Point = { top: number; left: number };

/** ⌘/Ctrl + Alt + M — the same selection, without reaching for the mouse. */
function isShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "m";
}

/**
 * The "Kommentieren" affordance that follows a text selection.
 *
 * Positioned by hand from ProseMirror's own coordinates rather than mounted
 * inside the editor: it is owned by the comment layer (which holds the draft
 * state), and a `fixed` element can live anywhere in the tree. `onMouseDown`
 * keeps the click from stealing focus — losing it would collapse the very
 * selection the comment is about.
 */
export function CommentBubble({
  editor,
  onComment,
}: {
  editor: Editor | null;
  onComment: () => void;
}) {
  const [point, setPoint] = useState<Point | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { state, view } = editor;
      const { from, to, empty } = state.selection;
      if (empty || !editor.isEditable || !state.doc.textBetween(from, to, " ").trim()) {
        setPoint(null);
        return;
      }
      try {
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        setPoint({ top: Math.min(start.top, end.top), left: (start.left + end.left) / 2 });
      } catch {
        // The selection can point at a position that is not laid out yet (a
        // remote change landing mid-render). Fall back to the top of the editor
        // rather than withholding the action: a slightly misplaced button is
        // recoverable, a missing one is not — and the next transaction
        // re-measures anyway.
        const box = view.dom.getBoundingClientRect();
        setPoint({ top: box.top, left: box.left + box.width / 2 });
      }
    };
    const hide = () => setPoint(null);

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcut(event) || editor.state.selection.empty || !editor.isEditable) return;
      event.preventDefault();
      onComment();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor, onComment]);

  if (!point) return null;

  return (
    <div
      className="fixed z-40 -translate-x-1/2 -translate-y-full pb-2"
      style={{ top: point.top, left: point.left }}
    >
      <button
        type="button"
        title="Kommentieren (⌘/Strg + Alt + M)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onComment}
        className="flex items-center gap-1.5 rounded-md border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md transition-colors hover:bg-accent"
      >
        <MessageSquarePlus className="size-3.5" /> Kommentieren
      </button>
    </div>
  );
}
