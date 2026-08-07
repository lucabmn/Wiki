import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@nilovon-wiki/ui/components/sheet";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * A space's trash: what was deleted, when it expires, and the two ways out.
 *
 * Expiry is stated per entry rather than once at the top, because that is the
 * only number that matters to the person looking: "noch 6 Tage" tells them
 * whether they need to act now. A blocked entry says so instead of showing a
 * date that will quietly pass without anything happening.
 */
export function SpaceTrashSheet({
  open,
  onOpenChange,
  spaceId,
  spaceName,
  nameOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  spaceName: string;
  /** Resolves a user id to a display name via the org member list. */
  nameOf: (userId: string | null) => string;
}) {
  const invalidateTrash = useInvalidate(orpc.trash.key());
  const invalidatePages = useInvalidate(orpc.pages.key());
  const [confirmPurge, setConfirmPurge] = useState<{ id: string; title: string } | null>(null);

  const trashQuery = useQuery(
    orpc.trash.listPages.queryOptions({ input: { spaceId }, enabled: open }),
  );

  const refresh = () => {
    invalidateTrash();
    invalidatePages();
  };

  const restore = useMutation(
    orpc.trash.restorePage.mutationOptions({
      onSuccess: (result) => {
        refresh();
        toast.success(
          result.restored > 1
            ? `Seite mit ${result.restored - 1} Unterseiten wiederhergestellt`
            : "Seite wiederhergestellt",
        );
      },
      onError: toastError,
    }),
  );

  const purge = useMutation(
    orpc.trash.purgePage.mutationOptions({
      onSuccess: () => {
        refresh();
        setConfirmPurge(null);
        toast.success("Seite endgültig gelöscht");
      },
      onError: toastError,
    }),
  );

  const entries = trashQuery.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Papierkorb</SheetTitle>
          <SheetDescription>
            Gelöschte Seiten aus „{spaceName}“. Nach Ablauf der Frist werden sie samt Anhängen
            endgültig entfernt.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {trashQuery.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <Empty className="rounded-xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Trash2 className="size-6" />
                </EmptyMedia>
                <EmptyTitle>Papierkorb ist leer</EmptyTitle>
                <EmptyDescription>
                  Gelöschte Seiten landen hier und bleiben bis zum Ablauf der Frist
                  wiederherstellbar.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 p-3">
                  <span className="mt-0.5 shrink-0 leading-none">
                    {entry.icon ?? <FileText className="size-4 text-muted-foreground" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {entry.title || "Ohne Titel"}
                      </span>
                      {entry.archivedAt ? (
                        <Badge variant="outline" className="text-[11px]">
                          war archiviert
                        </Badge>
                      ) : null}
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
                      // Blocked entries hide the affordance rather than offering
                      // a button that is guaranteed to fail.
                      disabled={entry.held || purge.isPending}
                      onClick={() => setConfirmPurge({ id: entry.id, title: entry.title })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AlertDialog
          open={confirmPurge !== null}
          onOpenChange={(next) => !next && setConfirmPurge(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Endgültig löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                „{confirmPurge?.title}“ wird mit allen Unterseiten und Anhängen sofort und
                unwiderruflich entfernt. Das Warten auf den Fristablauf entfällt damit.
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
      </SheetContent>
    </Sheet>
  );
}
