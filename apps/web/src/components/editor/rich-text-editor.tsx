import type { JSONContent } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";

import { EditorToolbar } from "./editor-toolbar";
import { pageEditorExtensions } from "./extensions";
import { SlashCommand } from "./slash-command";
import "./editor.css";

/**
 * Rich-text page editor. Uncontrolled (TipTap owns the document); reports every
 * change up as `{ json, text }` so the parent can autosave the draft and persist
 * on save. `text` is the flattened plain text that feeds the search vector.
 */
export function RichTextEditor({
  spaceId,
  initialContent,
  onChange,
}: {
  spaceId: string;
  initialContent: JSONContent | null;
  onChange: (value: { json: JSONContent; text: string }) => void;
}) {
  const editor = useEditor({
    // `_auth` renders client-only (ssr: false), but keep this off to avoid any
    // hydration mismatch and to match TipTap's SSR-safe guidance.
    immediatelyRender: false,
    extensions: [...pageEditorExtensions(), SlashCommand],
    content: initialContent ?? "",
    editorProps: {
      attributes: {
        class: "tiptap min-h-[320px] px-4 py-3 focus:outline-none",
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange({ json: instance.getJSON(), text: instance.getText() });
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card/40">
      {editor ? <EditorToolbar editor={editor} spaceId={spaceId} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
