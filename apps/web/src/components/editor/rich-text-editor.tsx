import { pageHref } from "@nilovon-wiki/api/lib/page-href";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { env } from "@nilovon-wiki/env/web";
import type { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { CharacterCount } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { cleverEditorExtensions } from "./clever";
import { EditorToolbar } from "./editor-toolbar";
import { ExternalLinkDialog } from "./external-link-dialog";
import { pageEditorExtensions } from "./extensions";
import { applyLink } from "./link-commands";
import { LinkPageDialog } from "./link-page-dialog";
import { createMentionSuggestion } from "./mention";
import { createSlashCommand } from "./slash-command";
import "./editor.css";

/** What the external-link dialog needs to know about the selection it opened on. */
type ExternalLinkTarget = { initialUrl: string | null; showText: boolean };

/**
 * Collaborative rich-text page editor. The document lives in the shared Yjs doc
 * (`doc`) synced by `provider`; TipTap owns no independent content, so we pass
 * NO `content` to `useEditor` — the initial state comes from the Yjs doc once
 * the provider syncs. StarterKit's undo/redo is disabled (see
 * `pageEditorExtensions({ collaborative: true })`) because `Collaboration` ships
 * its own Yjs-backed history.
 *
 * The link dialogs live here rather than in the toolbar because both the
 * toolbar and the slash menu open them, and a dialog can only have one owner.
 * `CharacterCount` is added on top of the shared extension set: it contributes
 * no nodes or marks, so the collab server and the read-only renderer stay on
 * the identical schema while the editor gets a live word count.
 */
export function RichTextEditor({
  pageId,
  spaceId,
  doc,
  provider,
  user,
  onEditor,
}: {
  pageId?: string;
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
  const [pageLinkOpen, setPageLinkOpen] = useState(false);
  const [externalLink, setExternalLink] = useState<ExternalLinkTarget | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const openPageLink = useCallback(() => setPageLinkOpen(true), []);
  // Snapshotted at open time rather than read during render: the dialog steals
  // focus, and by the time it submits the editor's selection is stale anyway.
  const openExternalLink = useCallback((instance: Editor) => {
    const href = instance.getAttributes("link").href as string | undefined;
    const onLink = Boolean(href);
    setExternalLink({
      // An internal `/pages/<id>` href is not an external URL — the dialog would
      // reject it — so only a real web address pre-fills the field.
      initialUrl: href?.startsWith("http") ? href : null,
      showText: instance.state.selection.empty && !onLink,
    });
  }, []);

  const mention = useMemo(() => createMentionSuggestion(spaceId), [spaceId]);
  const slashCommand = useMemo(
    () =>
      createSlashCommand({
        linkPage: openPageLink,
        linkExternal: openExternalLink,
        image: pageId ? () => imageInputRef.current?.click() : undefined,
      }),
    [openPageLink, openExternalLink, pageId],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...pageEditorExtensions({ collaborative: true, mention }),
      ...cleverEditorExtensions(),
      CharacterCount,
      slashCommand,
      Collaboration.configure({ document: doc }),
      CollaborationCaret.configure({ provider, user }),
    ],
    editorProps: {
      attributes: {
        // No padding: the body must sit flush at the content column's left edge,
        // exactly where the read view renders it.
        class: "tiptap min-h-[320px] py-3 focus:outline-none",
      },
    },
  });

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  const uploadImage = useCallback(
    async (file: File) => {
      if (!editor || !pageId) return;
      if (!/^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(file.type)) {
        toast.error("Dieser Bildtyp kann nicht sicher eingebettet werden.");
        return;
      }
      setImageUploading(true);
      try {
        const body = new FormData();
        body.set("file", file, file.name);
        body.set("spaceId", spaceId);
        body.set("pageId", pageId);
        body.set("draft", "true");
        const response = await fetch(`${env.VITE_SERVER_URL}/attachments/upload`, {
          method: "POST",
          credentials: "include",
          body,
        });
        const payload = (await response.json().catch(() => null)) as {
          id?: string;
          message?: string;
        } | null;
        if (!response.ok || !payload?.id) {
          throw new Error(payload?.message ?? "Bild-Upload fehlgeschlagen");
        }
        const baseUrl = env.VITE_SERVER_URL.replace(/\/$/, "");
        editor
          .chain()
          .focus()
          .setImage({
            src: `${baseUrl}/attachments/${payload.id}/inline`,
            alt: file.name,
            title: file.name,
          })
          .run();
        toast.success("Bild eingefügt");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Bild-Upload fehlgeschlagen");
      } finally {
        setImageUploading(false);
      }
    },
    [editor, pageId, spaceId],
  );

  return (
    // Frameless: the editing surface is the read surface, only the sticky
    // toolbar marks it as editable.
    <div>
      {editor ? (
        <EditorToolbar
          editor={editor}
          onLinkPage={openPageLink}
          onLinkExternal={() => openExternalLink(editor)}
          onImage={pageId ? () => imageInputRef.current?.click() : undefined}
          imageUploading={imageUploading}
        />
      ) : null}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
        className="hidden"
        aria-label="Bild hochladen"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void uploadImage(file);
        }}
      />
      <EditorContent editor={editor} />
      {editor ? <DocumentStats editor={editor} /> : null}

      {editor ? (
        <>
          <LinkPageDialog
            spaceId={spaceId}
            open={pageLinkOpen}
            onOpenChange={setPageLinkOpen}
            onPick={({ id, title }) => applyLink(editor, { href: pageHref(id), text: title })}
          />
          <ExternalLinkDialog
            open={externalLink !== null}
            onOpenChange={(open) => {
              if (!open) setExternalLink(null);
            }}
            initialUrl={externalLink?.initialUrl ?? null}
            showText={externalLink?.showText ?? true}
            onSubmit={(link) => applyLink(editor, link)}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Live word/character count under the body. Reads through `useEditorState` so it
 * re-renders on document changes — `useEditor` alone does not re-render on
 * transactions.
 */
function DocumentStats({ editor }: { editor: Editor }) {
  const stats = useEditorState({
    editor,
    selector: ({ editor }) => ({
      words: editor.storage.characterCount.words() as number,
      characters: editor.storage.characterCount.characters() as number,
    }),
  });

  return (
    <p className="mt-2 text-xs text-muted-foreground" aria-live="off">
      {stats.words} {stats.words === 1 ? "Wort" : "Wörter"} · {stats.characters} Zeichen
    </p>
  );
}
