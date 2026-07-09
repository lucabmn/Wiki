import { authClient } from "@/lib/auth-client";
import { toastError, useInvalidate } from "@/lib/query";
import { client, orpc } from "@/utils/orpc";
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { collabDocName } from "@nilovon-wiki/api/lib/collab-token";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import { env } from "@nilovon-wiki/env/web";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import type { Editor } from "@tiptap/core";
import { useMutation } from "@tanstack/react-query";
import { Check, History, Loader2, Send, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { RichTextEditor } from "./rich-text-editor";
import { RevisionHistory } from "./revision-history";

/**
 * Full edit experience for a page: title + real-time collaborative rich-text
 * body, plus explicit save/publish and version history. Mounted only after the
 * caller confirms `page: ["update"]`, and it re-checks `page: ["publish"]` for
 * the publish action — mirroring the server's authorization so the UI never
 * offers an action the API would reject.
 *
 * Collaboration model: the page body lives in a shared Yjs document synced by
 * `apps/collab` (see `RichTextEditor`). The collab server projects the live doc
 * back into `page.content`/`textContent` on a debounce, so concurrent editors
 * merge without clobbering. "Speichern"/"Veröffentlichen" additionally flush the
 * editor's current document to the DB immediately (deterministic, not waiting on
 * the debounce) — the title, which is not collaborative, rides along.
 */
export function PageEditor({
  page,
  onDone,
  canPublish,
}: {
  page: Page;
  onDone: () => void;
  // Passed from the page view, which resolves the caller's effective page role.
  canPublish: boolean;
}) {
  const { data: session } = authClient.useSession();
  const user = useMemo(
    () => ({
      name: session?.user.name || session?.user.email || "Anonym",
      color: userColor(session?.user.id ?? "anon"),
    }),
    [session?.user.name, session?.user.email, session?.user.id],
  );

  return <PageEditorForm page={page} onDone={onDone} canPublish={canPublish} user={user} />;
}

function PageEditorForm({
  page,
  onDone,
  canPublish,
  user,
}: {
  page: Page;
  onDone: () => void;
  canPublish: boolean;
  user: { name: string; color: string };
}) {
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const invalidatePage = useInvalidate(orpc.pages.get.key());
  const invalidateList = useInvalidate(orpc.pages.list.key());

  const update = useMutation(orpc.pages.update.mutationOptions({ onError: toastError }));
  const publish = useMutation(orpc.pages.publish.mutationOptions({ onError: toastError }));

  // One Yjs document + provider per page. The provider authenticates with a
  // short-lived, page-scoped token minted by `pages.collabToken`; passing it as
  // an async function lets Hocuspocus re-fetch a fresh token on every reconnect.
  const doc = useMemo(() => new Y.Doc(), [page.id]);
  const provider = useMemo(
    () =>
      new HocuspocusProvider({
        url: env.VITE_COLLAB_URL,
        name: collabDocName(page.id),
        document: doc,
        token: async () => (await client.pages.collabToken({ id: page.id })).token,
        onStatus: ({ status }) => setStatus(status),
      }),
    [page.id, doc],
  );

  useEffect(() => {
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [provider, doc]);

  // Flush the current title + live document to the DB. Title-only pages (no
  // editor yet) still persist their title.
  const persist = async () => {
    const trimmed = title.trim() || "Untitled";
    const editor = editorRef.current;
    await update.mutateAsync({
      id: page.id,
      title: trimmed,
      ...(editor ? { content: editor.getJSON(), textContent: editor.getText() } : {}),
    });
  };

  const finish = () => {
    invalidatePage();
    invalidateList();
    onDone();
  };

  const handleSave = async () => {
    await persist();
    finish();
  };

  const handlePublish = async () => {
    await persist();
    await publish.mutateAsync({ id: page.id });
    finish();
  };

  const busy = update.isPending || publish.isPending;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <ConnectionIndicator status={status} saving={update.isPending} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History className="size-4" /> Verlauf
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onDone}>
            <X className="size-4" /> Abbrechen
          </Button>
          <Button size="sm" disabled={busy} onClick={handleSave}>
            <Check className="size-4" /> {update.isPending ? "Speichern …" : "Speichern"}
          </Button>
          {canPublish ? (
            <Button size="sm" variant="default" disabled={busy} onClick={handlePublish}>
              <Send className="size-4" />{" "}
              {publish.isPending ? "Veröffentlichen …" : "Veröffentlichen"}
            </Button>
          ) : null}
        </div>
      </div>

      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Seitentitel"
        maxLength={300}
        className="mb-3 border border-border bg-card/40"
      />

      <RichTextEditor
        spaceId={page.spaceId}
        doc={doc}
        provider={provider}
        user={user}
        onEditor={(editor) => {
          editorRef.current = editor;
        }}
      />

      <RevisionHistory
        pageId={page.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore
        onRestore={(revision) => {
          // Apply into the live shared doc so all connected editors converge and
          // the collab store persists it — no server-side content write (which
          // the in-memory Yjs doc would clobber).
          setTitle(revision.title);
          editorRef.current?.commands.setContent(revision.content ?? { type: "doc", content: [] });
        }}
      />
    </div>
  );
}

/** Deterministic HSL cursor color from a user id, so each editor is stable. */
function userColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 70% 50%)`;
}

function ConnectionIndicator({ status, saving }: { status: WebSocketStatus; saving: boolean }) {
  if (saving) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Speichern …
      </span>
    );
  }
  if (status === WebSocketStatus.Connected) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5 text-emerald-500" /> Live – Änderungen werden geteilt
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> Verbinde …
    </span>
  );
}
