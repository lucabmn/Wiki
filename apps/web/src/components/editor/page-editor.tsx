import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { Page } from "@nilovon-wiki/api/schemas/page";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { generateText } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { Check, History, Loader2, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { pageEditorExtensions } from "./extensions";
import { RichTextEditor } from "./rich-text-editor";
import { RevisionHistory } from "./revision-history";

const AUTOSAVE_MS = 900;

type Draft = { json: JSONContent; title: string };
type SaveState = "idle" | "saving" | "saved";

/**
 * Full edit experience for a page: title + rich-text body, per-user draft
 * autosave, explicit save/publish, and version history. Mounted only after the
 * caller confirms `page: ["update"]`, and it re-checks `page: ["publish"]` for
 * the publish action — mirroring the server's authorization so the UI never
 * offers an action the API would reject.
 *
 * Concurrency note: `pages.update` is last-write-wins (no rich collaboration).
 * The draft is per-user, so two editors don't clobber each other's autosaves,
 * but the final save of whoever presses "Speichern" last wins the page.
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
  // The autosave draft must be resolved before the editor mounts, because the
  // editor is uncontrolled — its initial content is set once.
  const { data: draft, isPending: draftPending } = useQuery(
    orpc.pages.getDraft.queryOptions({ input: { id: page.id } }),
  );

  if (draftPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const hasDraft = Boolean(draft && (draft.content || draft.title));
  return (
    <PageEditorForm
      page={page}
      onDone={onDone}
      canPublish={canPublish}
      initialTitle={draft?.title ?? page.title}
      initialContent={
        (draft?.content as JSONContent | null) ?? (page.content as JSONContent | null)
      }
      restoredFromDraft={hasDraft}
    />
  );
}

function PageEditorForm({
  page,
  onDone,
  canPublish,
  initialTitle,
  initialContent,
  restoredFromDraft,
}: {
  page: Page;
  onDone: () => void;
  canPublish: boolean;
  initialTitle: string;
  initialContent: JSONContent | null;
  restoredFromDraft: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draftBanner, setDraftBanner] = useState(restoredFromDraft);

  // Latest editor value, kept in a ref so autosave/save read it without
  // re-rendering the editor on every keystroke. `textContent` is derived from
  // the JSON at save time (not tracked separately), so a title-only edit can't
  // blank the search field.
  const latest = useRef<Draft>({
    json: initialContent ?? { type: "doc", content: [] },
    title: initialTitle,
  });
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidatePage = useInvalidate(orpc.pages.get.key());
  const invalidateList = useInvalidate(orpc.pages.list.key());

  const saveDraft = useMutation(orpc.pages.saveDraft.mutationOptions({ onError: toastError }));
  const deleteDraft = useMutation(orpc.pages.deleteDraft.mutationOptions());
  const update = useMutation(orpc.pages.update.mutationOptions({ onError: toastError }));
  const publish = useMutation(orpc.pages.publish.mutationOptions({ onError: toastError }));

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSaveState("saving");
    autosaveTimer.current = setTimeout(() => {
      saveDraft.mutate(
        { pageId: page.id, title: latest.current.title, content: latest.current.json },
        { onSuccess: () => setSaveState("saved") },
      );
    }, AUTOSAVE_MS);
  }, [page.id, saveDraft]);

  // Flush any pending autosave timer on unmount.
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const onEditorChange = useCallback(
    (value: { json: JSONContent }) => {
      latest.current = { ...latest.current, json: value.json };
      setDraftBanner(false);
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  const onTitleChange = (value: string) => {
    setTitle(value);
    latest.current = { ...latest.current, title: value };
    setDraftBanner(false);
    scheduleAutosave();
  };

  const persist = async () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const trimmed = latest.current.title.trim() || "Untitled";
    // Derive plain text from the document so the search field always matches the
    // saved body — independent of whether the body was the thing that changed.
    const textContent = generateText(latest.current.json, pageEditorExtensions());
    await update.mutateAsync({
      id: page.id,
      title: trimmed,
      content: latest.current.json,
      textContent,
    });
  };

  const finish = () => {
    deleteDraft.mutate({ id: page.id });
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
        <SaveIndicator state={saveState} />
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

      {draftBanner ? (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Nicht gespeicherter Entwurf wiederhergestellt. Speichern übernimmt ihn, Abbrechen behält
          ihn für später.
        </p>
      ) : null}

      <Input
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Seitentitel"
        maxLength={300}
        className="mb-3 border border-border bg-card/40"
      />

      <RichTextEditor
        spaceId={page.spaceId}
        initialContent={initialContent}
        onChange={onEditorChange}
      />

      <RevisionHistory
        pageId={page.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return <span className="text-xs text-muted-foreground">Bearbeiten</span>;
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Entwurf wird gespeichert …
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="size-3.5 text-emerald-500" /> Entwurf gespeichert
    </span>
  );
}
