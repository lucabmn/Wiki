import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pencil, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { PageContent } from "@/components/editor/page-content";
import { QueryError } from "@/components/query-error";
import { formatDateTime } from "@/lib/format";
import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nilovon-wiki/ui/components/alert-dialog";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";

/**
 * Course announcements: write, publish, edit, delete.
 *
 * `publishedAt` is the whole state machine — null is a draft that only the
 * course team can list, a date is an announcement the learners have. Publishing
 * is therefore a flag on the update call rather than its own procedure, and
 * re-publishing keeps the original date, so "edit" and "publish" are genuinely
 * different acts here.
 *
 * The body is written as plain text and stored as the editor's document JSON:
 * the rich editor in this app is collab-bound (it needs a Yjs document and a
 * Hocuspocus provider), and an announcement is a short notice, not a page.
 */

/** Plain text → the minimal TipTap document `PageContent` renders back. */
function toDocument(text: string): unknown {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((block) => ({
      type: "paragraph",
      content: [{ type: "text", text: block }],
    })),
  };
}

/** The document JSON back to the plain text the composer edits. */
function toPlainText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const nodes = (content as { content?: unknown[] }).content ?? [];
  return nodes
    .map((node) => {
      const children = (node as { content?: unknown[] }).content ?? [];
      return children
        .map((child) => (child as { text?: string }).text ?? "")
        .join("")
        .trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

type Draft = { id: string | null; title: string; body: string; notify: boolean };

const EMPTY_DRAFT: Draft = { id: null, title: "", body: "", notify: true };

export function CourseAnnouncements({
  courseId,
  canAuthor,
}: {
  courseId: string;
  canAuthor: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const announcements = useQuery(
    orpc.learn.courseUpdates.list.queryOptions({ input: { courseId } }),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.learn.courseUpdates.list.key() });

  const create = useMutation(
    orpc.learn.courseUpdates.create.mutationOptions({
      onSuccess: (row) => {
        void invalidate();
        setDraft(null);
        toast.success(row.publishedAt ? "Ankündigung veröffentlicht" : "Entwurf gespeichert");
      },
      onError: toastError,
    }),
  );

  const update = useMutation(
    orpc.learn.courseUpdates.update.mutationOptions({
      onSuccess: (row) => {
        void invalidate();
        setDraft(null);
        toast.success(row.publishedAt ? "Ankündigung veröffentlicht" : "Als Entwurf gespeichert");
      },
      onError: toastError,
    }),
  );

  const remove = useMutation(
    orpc.learn.courseUpdates.delete.mutationOptions({
      onSuccess: () => {
        void invalidate();
        setDeleteTarget(null);
        toast.success("Ankündigung gelöscht");
      },
      onError: toastError,
    }),
  );

  const saving = create.isPending || update.isPending;

  const submit = (publish: boolean) => {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) return;
    const content = draft.body.trim() ? toDocument(draft.body) : null;
    if (draft.id === null) {
      create.mutate({ courseId, title, content, notifyLearners: draft.notify, publish });
    } else {
      update.mutate({ id: draft.id, title, content, notifyLearners: draft.notify, publish });
    }
  };

  const rows = announcements.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Entwürfe sieht nur das Kursteam. Veröffentlichte Ankündigungen stehen auf der Kursseite.
        </p>
        {canAuthor ? (
          <Button size="sm" onClick={() => setDraft(EMPTY_DRAFT)} disabled={draft?.id === null}>
            <Megaphone className="size-4" aria-hidden />
            Neue Ankündigung
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ankündigungen schreiben kann nur, wer Inhalte bearbeiten darf.
          </p>
        )}
      </div>

      {draft ? (
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="announcement-title">
              Titel
            </label>
            <Input
              id="announcement-title"
              value={draft.title}
              disabled={saving}
              placeholder="Worum geht es?"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="announcement-body">
              Text
            </label>
            <Textarea
              id="announcement-body"
              rows={6}
              value={draft.body}
              disabled={saving}
              placeholder="Eine Leerzeile trennt Absätze."
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.notify}
              disabled={saving}
              onCheckedChange={(next) => setDraft({ ...draft, notify: next === true })}
            />
            Teilnehmende beim Veröffentlichen benachrichtigen
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              Abbrechen
            </Button>
            <Button
              variant="outline"
              disabled={saving || !draft.title.trim()}
              onClick={() => submit(false)}
            >
              Als Entwurf speichern
            </Button>
            <Button disabled={saving || !draft.title.trim()} onClick={() => submit(true)}>
              <Send className="size-4" aria-hidden />
              {saving ? "Speichern …" : "Veröffentlichen"}
            </Button>
          </div>
        </Card>
      ) : null}

      {announcements.isError ? (
        <QueryError error={announcements.error} onRetry={() => void announcements.refetch()} />
      ) : announcements.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>Keine Ankündigungen</EmptyTitle>
            <EmptyDescription>
              Hier stehen Hinweise an alle Teilnehmenden — Termine, Änderungen, Erinnerungen.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const published = row.publishedAt !== null;
            return (
              <li key={row.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{row.title}</h3>
                        {published ? (
                          <Badge variant="secondary">Veröffentlicht</Badge>
                        ) : (
                          <Badge variant="outline">Entwurf — nur für das Kursteam</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.author ? `${row.author.name} · ` : ""}
                        {published
                          ? formatDateTime(row.publishedAt!)
                          : `zuletzt geändert ${formatDateTime(row.updatedAt)}`}
                      </p>
                    </div>

                    {canAuthor ? (
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`„${row.title}" bearbeiten`}
                          disabled={saving}
                          onClick={() =>
                            setDraft({
                              id: row.id,
                              title: row.title,
                              body: toPlainText(row.content),
                              notify: row.notifyLearners,
                            })
                          }
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            published
                              ? `„${row.title}" zurückziehen`
                              : `„${row.title}" veröffentlichen`
                          }
                          disabled={saving}
                          onClick={() => update.mutate({ id: row.id, publish: !published })}
                        >
                          {published ? (
                            <Undo2 className="size-4" aria-hidden />
                          ) : (
                            <Send className="size-4" aria-hidden />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`„${row.title}" löschen`}
                          disabled={remove.isPending}
                          onClick={() => setDeleteTarget({ id: row.id, title: row.title })}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {row.content ? <PageContent content={row.content} fallbackText="" /> : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ankündigung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `„${deleteTarget.title}" wird entfernt und verschwindet von der Kursseite. Diese Aktion kann nicht rückgängig gemacht werden.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) remove.mutate({ id: deleteTarget.id });
              }}
            >
              {remove.isPending ? "Löschen …" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
