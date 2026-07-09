import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect } from "react";
import type * as Y from "yjs";

import { cleverEditorExtensions } from "./clever";
import { EditorToolbar } from "./editor-toolbar";
import { pageEditorExtensions } from "./extensions";
import { SlashCommand } from "./slash-command";
import "./editor.css";

/**
 * Collaborative rich-text page editor. The document lives in the shared Yjs doc
 * (`doc`) synced by `provider`; TipTap owns no independent content, so we pass
 * NO `content` to `useEditor` — the initial state comes from the Yjs doc once
 * the provider syncs. StarterKit's undo/redo is disabled (see
 * `pageEditorExtensions({ collaborative: true })`) because `Collaboration` ships
 * its own Yjs-backed history.
 */
export function RichTextEditor({
  spaceId,
  doc,
  provider,
  user,
  onEditor,
}: {
  spaceId: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  // Identity shown on this client's remote-cursor label.
  user: { name: string; color: string };
  // Surfaces the live editor instance to the parent so it can read the current
  // document (`getJSON`/`getText`) at save/publish time — collab keeps the body
  // in the Yjs doc, not in React state.
  onEditor?: (editor: Editor | null) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...pageEditorExtensions({ collaborative: true }),
      ...cleverEditorExtensions(),
      SlashCommand,
      Collaboration.configure({ document: doc }),
      CollaborationCaret.configure({ provider, user }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap min-h-[320px] px-4 py-3 focus:outline-none",
      },
    },
  });

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  return (
    <div className="rounded-xl border border-border bg-card/40">
      {editor ? <EditorToolbar editor={editor} spaceId={spaceId} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
