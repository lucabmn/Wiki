import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Folder, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatDate, timeAgo } from "@/lib/format";
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
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * Deleted spaces, org-wide.
 *
 * They live here rather than in the space list because a trashed space has no
 * page to open — its own settings sheet is unreachable by design. The
 * organization's data-lifecycle settings are the one place left that can still
 * bring it back.
 */
export function TrashedSpaces({ nameOf }: { nameOf: (userId: string | null) => string }) {
  const invalidateTrash = useInvalidate(orpc.trash.key());
  const invalidateSpaces = useInvalidate(orpc.spaces.list.key());
  const [confirmPurge, setConfirmPurge] = useState<{ id: string; title: string } | null>(null);

  const trashQuery = useQuery(orpc.trash.listSpaces.queryOptions({ input: {} }));

  const refresh = () => {
    invalidateTrash();
    invalidateSpaces();
  };

  const restore = useMutation(
    orpc.trash.restoreSpace.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success("Bereich wiederhergestellt");
      },
      onError: toastError,
    }),
  );

  const purge = useMutation(
    orpc.trash.purgeSpace.mutationOptions({
      onSuccess: () => {
        refresh();
        setConfirmPurge(null);
        toast.success("Bereich endgültig gelöscht");
      },
      onError: toastError,
    }),
  );

  if (trashQuery.isPending) return <Skeleton className="h-20 w-full rounded-lg" />;

  const entries = trashQuery.data ?? [];
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Kein Bereich liegt im Papierkorb. Gelöschte Seiten findest du im Papierkorb des jeweiligen
        Bereichs.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 p-3">
            <span
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] text-white"
              style={{ backgroundColor: entry.color ?? "#64748B" }}
            >
              {entry.icon ?? <Folder className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{entry.title}</span>
                <Badge variant="outline" className="text-[11px]">
                  {entry.pageCount} {entry.pageCount === 1 ? "Seite" : "Seiten"}
                </Badge>
                {entry.held ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-amber-500/40 text-[11px] text-amber-700"
                  >
                    <ShieldCheck className="size-3" />
                    Löschsperre
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Gelöscht {timeAgo(entry.deletedAt)} von {nameOf(entry.deletedBy)}
                {" · "}
                {entry.held
                  ? "bleibt erhalten, solange die Sperre besteht"
                  : `läuft ab am ${formatDate(entry.expiresAt)}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={restore.isPending}
                onClick={() => restore.mutate({ id: entry.id })}
              >
                <RotateCcw className="size-3.5" />
                Wiederherstellen
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`„${entry.title}" endgültig löschen`}
                disabled={entry.held || purge.isPending}
                onClick={() => setConfirmPurge({ id: entry.id, title: entry.title })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={confirmPurge !== null}
        onOpenChange={(next) => !next && setConfirmPurge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bereich endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              „{confirmPurge?.title}“ wird mit allen Seiten, Kommentaren und Anhängen sofort und
              unwiderruflich entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purge.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={purge.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (confirmPurge) purge.mutate({ id: confirmPurge.id });
              }}
            >
              {purge.isPending ? "Löschen …" : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
