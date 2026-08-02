import { authClient } from "@/lib/auth-client";
import { STATUS_LABEL } from "@/lib/labels";
import { toastError, useInvalidate } from "@/lib/query";
import { client, orpc } from "@/utils/orpc";
import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { collabDocName } from "@nilovon-wiki/api/lib/collab-token";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import { env } from "@nilovon-wiki/env/web";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import type { Editor } from "@tiptap/core";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { Check, FileText, History, Loader2, Send, Users, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
 * Layout: this renders *inside* the read view's content column and mirrors its
 * header structure (icon · title · action slot, then the meta line) so switching
 * modes swaps affordances in place instead of re-flowing the page. The route
 * keeps the same shell — width, tag row, attachments, comments and right rail —
 * around it; see `routes/_auth/pages/$id.tsx`.
 *
 * Publish model: the page body lives in a shared Yjs document synced by
 * `apps/collab` (see `RichTextEditor`), which persists it as the private working
 * draft (`yjsState`) only. The DB's `content`/`textContent` — what readers,
 * search, and backlinks see — advance ONLY when "Veröffentlichen" promotes the
 * editor's current document via `pages.publish`. So:
 *  - "Schließen" just leaves the editor; the collaborative draft is untouched
 *    (a shared doc can't be privately discarded).
 *  - "Speichern" persists the (non-collaborative) title as a draft and closes;
 *    the body is already autosaved by collab.
 *  - "Veröffentlichen" promotes body + title into the published projection.
 *
 * Which of those apply depends on status, because `title` has no draft/published
 * split the way the body does (one `page.title` column vs. `content` + the
 * collab-owned `yjsState`). Saving a title on a *published* page therefore goes
 * live immediately — a publish wearing a draft's label. So "Speichern" only
 * shows while the page is still a draft, and a published page offers exactly
 * two exits: leave, or publish the changes. That also makes the hint below the
 * header honest: on a published page nothing an editor does reaches readers
 * until they publish.
 *
 * The title is local React state, so every exit — "Schließen", navigation,
 * reload — confirms before discarding an unsaved one.
 */
export function PageEditor({
  page,
  onDone,
  canPublish,
  belowHeader,
  historyOpen,
  onHistoryOpenChange,
}: {
  page: Page;
  onDone: () => void;
  // Passed from the page view, which resolves the caller's effective page role.
  canPublish: boolean;
  // Rendered between header and body, where the read view puts its tag row —
  // passed in rather than mounted here so the editor keeps its narrow deps.
  belowHeader?: ReactNode;
  // The right rail (route-owned) opens the same history sheet the header button
  // does; pass these to share one open state. Uncontrolled works standalone.
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
}) {
  const { data: session } = authClient.useSession();
  const user = useMemo(
    () => ({
      name: session?.user.name || session?.user.email || "Anonym",
      color: userColor(session?.user.id ?? "anon"),
    }),
    [session?.user.name, session?.user.email, session?.user.id],
  );

  return (
    <PageEditorForm
      page={page}
      onDone={onDone}
      canPublish={canPublish}
      user={user}
      belowHeader={belowHeader}
      historyOpen={historyOpen}
      onHistoryOpenChange={onHistoryOpenChange}
    />
  );
}

function PageEditorForm({
  page,
  onDone,
  canPublish,
  user,
  belowHeader,
  historyOpen,
  onHistoryOpenChange,
}: {
  page: Page;
  onDone: () => void;
  canPublish: boolean;
  user: { name: string; color: string };
  belowHeader?: ReactNode;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [syncing, setSyncing] = useState(false);
  // Controlled by the route when it also drives the right rail's entry point;
  // otherwise the editor keeps the sheet's open state itself.
  const [ownHistoryOpen, setOwnHistoryOpen] = useState(false);
  const setHistoryOpen = onHistoryOpenChange ?? setOwnHistoryOpen;
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

  const finish = async () => {
    // Keep the editor mounted until the active detail query has the saved row.
    // Otherwise a quick reopen receives the previous cached `page` prop and
    // initializes its local title state from that stale value.
    await invalidatePage();
    invalidateList();
    onDone();
  };

  const syncBody = async () => {
    setSyncing(true);
    try {
      await waitForCollabSync(provider);
      return true;
    } catch {
      toast.error("Änderungen konnten noch nicht synchronisiert werden. Bitte erneut versuchen.");
      return false;
    } finally {
      setSyncing(false);
    }
  };

  // "Speichern": persist only the title (the body is a collaborative draft,
  // continuously autosaved by the collab server) and close.
  const handleSave = async () => {
    if (!(await syncBody())) return;
    await update.mutateAsync({ id: page.id, title: title.trim() || "Ohne Titel" });
    toast.success("Entwurf gespeichert");
    await finish();
  };

  // "Veröffentlichen": promote the current working copy — body (read from the
  // live editor) plus title — into the published projection readers see.
  const handlePublish = async () => {
    if (!(await syncBody())) return;
    const editor = editorRef.current;
    await publish.mutateAsync({
      id: page.id,
      title: title.trim() || "Ohne Titel",
      ...(editor ? { content: editor.getJSON(), textContent: editor.getText() } : {}),
    });
    toast.success(
      page.status === "published" ? "Änderungen veröffentlicht" : "Seite veröffentlicht",
    );
    await finish();
  };

  const busy = syncing || update.isPending || publish.isPending;

  // Publishing an already-published page doesn't publish it *again* — it
  // promotes the working copy into the projection readers see. Naming that
  // keeps the button from reading as a no-op next to the "Veröffentlicht" badge.
  const published = page.status === "published";
  const publishLabel = published ? "Änderungen veröffentlichen" : "Veröffentlichen";

  // "Speichern" only earns a slot while a draft can still be *kept* a draft. On
  // a published page it would write the title straight into the reader-facing
  // column — a publish in all but name — so publishing is the only save there.
  // (The `!canPublish` arm is unreachable today: `update` and `publish` are
  // gated on the same `write` capability; it stands in case they ever split.)
  const showSave = !published || !canPublish;

  // The title is not part of the collaborative doc, so unsaved title edits would
  // be lost silently. Everything that leaves the editor has to ask first — but
  // stand down while a save/publish is in flight (which persists the title).
  const titleDirty = title !== page.title;
  const confirmDiscardTitle = () =>
    !titleDirty ||
    window.confirm(
      showSave
        ? "Der Seitentitel hat ungespeicherte Änderungen. Ohne Speichern verlassen?"
        : "Der Seitentitel hat ungespeicherte Änderungen. Ohne Veröffentlichen verlassen?",
    );

  // "Schließen" is a local mode flip, not a navigation, so `useBlocker` never
  // sees it — it needs the same guard explicitly.
  const handleClose = () => {
    if (!confirmDiscardTitle()) return;
    onDone();
  };

  useBlocker({
    disabled: busy,
    shouldBlockFn: () => !confirmDiscardTitle(),
    enableBeforeUnload: () => titleDirty && !busy,
  });

  return (
    <>
      {/* Mirrors the read view's header row exactly — same spacing, same icon
          slot, same action rail — so nothing shifts when modes switch. */}
      <div className="mt-3 flex items-start gap-3">
        <span className="mt-1 text-2xl leading-none">
          {page.icon ?? <FileText className="size-6 text-muted-foreground" />}
        </span>
        <div className="min-w-0 flex-1">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Seitentitel"
            aria-label="Seitentitel"
            maxLength={300}
            className="h-auto rounded-none border-0 bg-transparent p-0 text-[30px] leading-tight font-semibold tracking-tight shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-[30px] dark:bg-transparent"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{STATUS_LABEL[page.status] ?? page.status}</Badge>
            <ConnectionIndicator status={status} saving={busy} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The right rail's history entry is `xl`-only, so keep a trigger in
              the header — same icon-only idiom as the read view's actions. */}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Versionsverlauf"
            title="Versionsverlauf"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="size-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={handleClose}>
            <X className="size-4" /> Schließen
          </Button>
          {showSave ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={handleSave}>
              <Check className="size-4" /> {update.isPending ? "Speichern …" : "Speichern"}
            </Button>
          ) : null}
          {canPublish ? (
            <Button size="sm" disabled={busy} onClick={handlePublish}>
              <Send className="size-4" /> {publish.isPending ? `${publishLabel} …` : publishLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {belowHeader ? <div className="mt-3 pl-9">{belowHeader}</div> : null}

      <p className="mt-3 pl-9 text-xs text-muted-foreground">
        {page.status === "published"
          ? "Änderungen sind erst nach „Veröffentlichen“ für andere sichtbar — bis dahin sehen Leser die zuletzt veröffentlichte Fassung."
          : "Änderungen sind erst nach „Veröffentlichen“ für andere sichtbar."}
      </p>

      <div className="mt-6">
        <RichTextEditor
          spaceId={page.spaceId}
          doc={doc}
          provider={provider}
          user={user}
          onEditor={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>

      <RevisionHistory
        pageId={page.id}
        open={historyOpen ?? ownHistoryOpen}
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
    </>
  );
}

const COLLAB_SYNC_TIMEOUT_MS = 10_000;

/** Wait until the server has acknowledged every local Yjs update. */
function waitForCollabSync(provider: HocuspocusProvider): Promise<void> {
  if (!provider.hasUnsyncedChanges) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      provider.off("unsyncedChanges", onUnsyncedChanges);
      if (error) reject(error);
      else resolve();
    };
    const onUnsyncedChanges = ({ number }: { number: number }) => {
      if (number === 0) finish();
    };
    const timeout = setTimeout(
      () => finish(new Error("Timed out waiting for collaborative changes to sync")),
      COLLAB_SYNC_TIMEOUT_MS,
    );

    provider.on("unsyncedChanges", onUnsyncedChanges);
    // Close the race where the final acknowledgement arrived before the
    // listener was registered.
    if (!provider.hasUnsyncedChanges) finish();
  });
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
