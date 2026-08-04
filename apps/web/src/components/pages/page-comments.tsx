import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { toastError, useInvalidate } from "@/lib/query";
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
import { Card, CardContent } from "@nilovon-wiki/ui/components/card";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** One comment, and the form that adds one. Lifted out of the page route as-is. */

export function CommentCard({
  comment,
}: {
  comment: { id: string; body: string; createdAt: Date };
}) {
  const invalidate = useInvalidate(orpc.comments.list.key());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const resolve = useMutation(
    orpc.comments.resolve.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Kommentar aufgelöst");
      },
      onError: toastError,
    }),
  );
  const remove = useMutation(
    orpc.comments.delete.mutationOptions({
      onSuccess: () => {
        invalidate();
        setConfirmDelete(false);
        toast.success("Kommentar gelöscht");
      },
      onError: toastError,
    }),
  );

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {dateFormat.format(comment.createdAt)}
          </div>
          <div className="-my-1 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: comment.id, resolved: true })}
            >
              <Check className="size-3.5" /> Auflösen
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              disabled={remove.isPending}
              aria-label="Kommentar löschen"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm whitespace-pre-wrap">{comment.body}</p>
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kommentar löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Kommentar wird dauerhaft entfernt. Das kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                remove.mutate({ id: comment.id });
              }}
            >
              {remove.isPending ? "Löschen …" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function CommentForm({ pageId }: { pageId: string }) {
  const invalidate = useInvalidate(orpc.comments.list.key());
  const [body, setBody] = useState("");

  const create = useMutation(
    orpc.comments.create.mutationOptions({
      onSuccess: () => {
        invalidate();
        setBody("");
        toast.success("Kommentar hinzugefügt");
      },
      onError: toastError,
    }),
  );

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed) create.mutate({ pageId, body: trimmed });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-3 space-y-2"
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Kommentar schreiben …"
        rows={3}
        maxLength={10_000}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending || !body.trim()}>
          {create.isPending ? "Senden …" : "Kommentieren"}
        </Button>
      </div>
    </form>
  );
}
