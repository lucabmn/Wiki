import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  LegalHoldBadge,
  LegalHoldControl,
  useHoldStatus,
} from "@/components/lifecycle/legal-hold-control";
import { SpaceTrashSheet } from "@/components/spaces/space-trash-sheet";
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

/**
 * The end of a space's life: its trash, its deletion block, and the archive and
 * delete actions.
 *
 * Split out of the settings sheet because these four things are the ones users
 * confuse, and they only read clearly when they sit next to each other —
 * archiving hides, deleting is recoverable, purging is not, and a block stops all
 * three.
 */
export function SpaceLifecycleSections({
  space,
  onClose,
  nameOf,
}: {
  space: { id: string; name: string; archivedAt: Date | null };
  /** Closes the parent sheet after an action that navigates away. */
  onClose: () => void;
  nameOf: (userId: string | null) => string;
}) {
  const navigate = useNavigate();
  const invalidateSpaces = useInvalidate(orpc.spaces.list.key());
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Read here so the danger zone can explain a refused delete *before* the
  // click, rather than surfacing a server error afterwards.
  const holdStatus = useHoldStatus({ spaceId: space.id });

  const archiveSpace = useMutation(
    orpc.spaces.archive.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        setConfirmArchive(false);
        onClose();
        toast.success("Space archiviert");
        // Archived spaces drop out of the default list, so the slug route would
        // show "nicht gefunden" — send the user back to the overview.
        navigate({ to: "/spaces" });
      },
      onError: toastError,
    }),
  );

  const restoreSpace = useMutation(
    orpc.spaces.restore.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        toast.success("Space wiederhergestellt");
      },
      onError: toastError,
    }),
  );

  const deleteSpace = useMutation(
    orpc.spaces.delete.mutationOptions({
      onSuccess: () => {
        invalidateSpaces();
        setConfirmDelete(false);
        onClose();
        toast.success("Space in den Papierkorb verschoben");
        navigate({ to: "/spaces" });
      },
      onError: toastError,
    }),
  );

  return (
    <>
      <section className="space-y-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">Papierkorb</h3>
          <p className="text-xs text-muted-foreground">
            Gelöschte Seiten dieses Spaces, mit Ablaufdatum und Wiederherstellung.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setTrashOpen(true)}>
          <Trash2 className="size-3.5" />
          Papierkorb öffnen
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Löschsperre</h3>
              <LegalHoldBadge status={holdStatus.data} />
            </div>
            <p className="text-xs text-muted-foreground">
              Verhindert jedes Löschen — dieses Space, seiner Seiten, Kommentare, Anhänge und
              Protokolleinträge. Auch der Fristablauf greift dann nicht.
            </p>
          </div>
          <LegalHoldControl
            subject="space"
            subjectId={space.id}
            subjectLabel={space.name}
            status={holdStatus.data}
          />
        </div>
      </section>

      {/* Gefahrenzone: der Sheet wird vom Aufrufer nur für Space-Admins
          gerendert (myRole === "admin"), dieselbe Schranke gilt hier. */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-destructive">Gefahrenzone</h3>
        <div className="divide-y divide-border rounded-lg border border-destructive/30">
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {space.archivedAt ? "Space ist archiviert" : "Space archivieren"}
              </div>
              <p className="text-xs text-muted-foreground">
                {space.archivedAt
                  ? "Ausgeblendet, aber vollständig erhalten. Jederzeit wieder aktivierbar."
                  : "Der Space wird ausgeblendet, Seiten bleiben erhalten."}
              </p>
            </div>
            {space.archivedAt ? (
              <Button
                variant="outline"
                size="sm"
                disabled={restoreSpace.isPending}
                onClick={() => restoreSpace.mutate({ id: space.id })}
              >
                <Archive className="size-3.5" />
                {restoreSpace.isPending ? "Aktivieren …" : "Wiederherstellen"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={archiveSpace.isPending}
                onClick={() => setConfirmArchive(true)}
              >
                Archivieren
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Space löschen</div>
              <p className="text-xs text-muted-foreground">
                {holdStatus.data?.held
                  ? "Nicht möglich: für diesen Space besteht eine Löschsperre."
                  : "Verschiebt den Space in den Papierkorb. Er bleibt bis zum Ablauf der Frist wiederherstellbar."}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              // Refused server-side anyway; disabling here means the user
              // learns why from the line above instead of from an error toast.
              disabled={deleteSpace.isPending || holdStatus.data?.held === true}
              onClick={() => setConfirmDelete(true)}
            >
              Löschen
            </Button>
          </div>
        </div>
      </section>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Space archivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              „{space.name}" wird ausgeblendet und erscheint nicht mehr in der Übersicht. Die Seiten
              bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveSpace.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveSpace.isPending}
              onClick={(event) => {
                event.preventDefault();
                archiveSpace.mutate({ id: space.id });
              }}
            >
              {archiveSpace.isPending ? "Archivieren …" : "Archivieren"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Space in den Papierkorb?</AlertDialogTitle>
            <AlertDialogDescription>
              „{space.name}" verschwindet mit allen Seiten aus allen Ansichten, bleibt aber bis zum
              Ablauf der Aufbewahrungsfrist wiederherstellbar. Danach wird er samt Anhängen
              endgültig gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSpace.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSpace.isPending}
              onClick={(event) => {
                event.preventDefault();
                deleteSpace.mutate({ id: space.id });
              }}
            >
              {deleteSpace.isPending ? "Verschieben …" : "In den Papierkorb"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SpaceTrashSheet
        open={trashOpen}
        onOpenChange={setTrashOpen}
        spaceId={space.id}
        spaceName={space.name}
        nameOf={nameOf}
      />
    </>
  );
}
