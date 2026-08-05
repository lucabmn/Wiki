import { useMutation } from "@tanstack/react-query";
import { Check, CornerDownRight, RotateCcw, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MentionTextarea } from "@/components/pages/mention-textarea";
import { toastError, useInvalidate } from "@/lib/query";
import type { CommentRow, InlineThread } from "@/lib/inline-comments";
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
import { Button } from "@nilovon-wiki/ui/components/button";
import { cn } from "@nilovon-wiki/ui/lib/utils";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

export type ThreadPermissions = {
  /** Role `commenter` or better: may reply and resolve. */
  canComment: boolean;
  /** Page write access: may delete anyone's comment, not just their own. */
  canModerate: boolean;
  viewerId: string | null;
};

/**
 * One inline thread in the rail: the quoted text it hangs on, the root comment,
 * its replies, and the actions the viewer's role actually allows.
 *
 * Clicking the quote focuses the highlight in the document; the document sends
 * focus back the other way (`InlineComments`), so the two stay in sync whichever
 * side the reader starts from.
 */
export function InlineCommentThread({
  thread,
  pageId,
  spaceId,
  active,
  permissions,
  nameOf,
  onActivate,
}: {
  thread: InlineThread;
  pageId: string;
  spaceId: string;
  active: boolean;
  permissions: ThreadPermissions;
  nameOf: (userId: string | null) => string;
  onActivate: () => void;
}) {
  const invalidate = useInvalidate(orpc.comments.list.key());
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CommentRow | null>(null);

  const resolve = useMutation(
    orpc.comments.resolve.mutationOptions({
      onSuccess: (_data, variables) => {
        invalidate();
        toast.success(variables.resolved ? "Kommentar aufgelöst" : "Kommentar wieder geöffnet");
      },
      onError: toastError,
    }),
  );
  const remove = useMutation(
    orpc.comments.delete.mutationOptions({
      onSuccess: () => {
        invalidate();
        setPendingDelete(null);
        toast.success("Kommentar gelöscht");
      },
      onError: toastError,
    }),
  );
  const create = useMutation(
    orpc.comments.create.mutationOptions({
      onSuccess: () => {
        invalidate();
        setReply("");
        setReplying(false);
      },
      onError: toastError,
    }),
  );

  const submitReply = () => {
    const body = reply.trim();
    if (body) create.mutate({ pageId, parentId: thread.root.id, body });
  };
  const mayDelete = (comment: CommentRow) =>
    permissions.canModerate ||
    (permissions.viewerId !== null && comment.authorId === permissions.viewerId);

  return (
    <article
      data-mark-id={thread.markId}
      data-top={thread.top}
      onClick={onActivate}
      className={cn(
        "rounded-lg border bg-card p-3 text-[13px] shadow-sm transition-colors",
        active ? "border-primary/60 ring-2 ring-primary/25" : "hover:border-border/80",
        thread.resolved && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        title={thread.anchor.excerpt}
        className={cn(
          "-mt-0.5 mb-2 block w-full truncate border-l-2 pl-2 text-left text-xs italic",
          thread.orphaned
            ? "border-muted-foreground/40 text-muted-foreground line-through"
            : "border-primary/50 text-muted-foreground hover:text-foreground",
        )}
      >
        {thread.anchor.excerpt || "Textstelle"}
      </button>

      {thread.orphaned ? (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Unlink className="size-3 shrink-0" />
          Textstelle nicht mehr im Dokument
        </p>
      ) : null}

      <CommentBody comment={thread.root} nameOf={nameOf} />

      {thread.replies.length ? (
        <ul className="mt-2 space-y-2 border-l pl-2.5">
          {thread.replies.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-2">
              <CommentBody comment={entry} nameOf={nameOf} />
              {mayDelete(entry) ? <DeleteButton onClick={() => setPendingDelete(entry)} /> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {permissions.canComment ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setReplying((open) => !open)}
          >
            <CornerDownRight className="size-3.5" /> Antworten
          </Button>
        ) : null}
        {permissions.canComment ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id: thread.root.id, resolved: !thread.resolved })}
          >
            {thread.resolved ? (
              <>
                <RotateCcw className="size-3.5" /> Wieder öffnen
              </>
            ) : (
              <>
                <Check className="size-3.5" /> Auflösen
              </>
            )}
          </Button>
        ) : null}
        {mayDelete(thread.root) ? (
          <DeleteButton className="ml-auto" onClick={() => setPendingDelete(thread.root)} />
        ) : null}
      </div>

      {replying ? (
        <div className="mt-2 space-y-1.5">
          <MentionTextarea
            spaceId={spaceId}
            value={reply}
            onChange={setReply}
            onSubmit={submitReply}
            placeholder="Antworten …"
            rows={2}
            maxLength={10_000}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setReplying(false)}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              className="h-7"
              disabled={create.isPending || !reply.trim()}
              onClick={submitReply}
            >
              {create.isPending ? "Senden …" : "Senden"}
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={() => setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kommentar löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Kommentar wird dauerhaft entfernt. Antworten darunter verschwinden mit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) remove.mutate({ id: pendingDelete.id });
              }}
            >
              {remove.isPending ? "Löschen …" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function CommentBody({
  comment,
  nameOf,
}: {
  comment: CommentRow;
  nameOf: (userId: string | null) => string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{nameOf(comment.authorId)}</span> ·{" "}
        {dateFormat.format(comment.createdAt)}
      </p>
      <p className="mt-0.5 wrap-anywhere whitespace-pre-wrap">{comment.body}</p>
    </div>
  );
}

function DeleteButton({ className, onClick }: { className?: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Kommentar löschen"
      className={cn("size-7 text-muted-foreground hover:text-destructive", className)}
      onClick={onClick}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
