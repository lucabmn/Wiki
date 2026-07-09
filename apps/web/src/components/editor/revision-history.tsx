import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Version history for a page. Lists the immutable revisions snapshotted at each
 * publish and lets a permitted user roll the page back to one. Restoring routes
 * through `pages.restoreRevision`, so it re-runs the same authorization the
 * server enforces.
 */
export function RevisionHistory({
  pageId,
  open,
  onOpenChange,
  canRestore,
}: {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
}) {
  const { data: revisions, isPending } = useQuery(
    orpc.pages.listRevisions.queryOptions({ input: { id: pageId }, enabled: open }),
  );

  const invalidatePage = useInvalidate(orpc.pages.get.key());
  const invalidateRevisions = useInvalidate(orpc.pages.listRevisions.key());
  const restore = useMutation(
    orpc.pages.restoreRevision.mutationOptions({
      onSuccess: () => {
        invalidatePage();
        invalidateRevisions();
        onOpenChange(false);
      },
      onError: toastError,
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Versionsverlauf</DialogTitle>
          <DialogDescription>
            Jede Veröffentlichung legt eine Version ab. Du kannst zu einer früheren zurückkehren.
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Lädt …</p>
        ) : !revisions?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Noch keine veröffentlichten Versionen.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {revisions.map((revision) => (
              <li
                key={revision.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <History className="size-3.5 text-muted-foreground" />
                    Version {revision.version}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {revision.title}
                    {revision.summary ? ` — ${revision.summary}` : ""} ·{" "}
                    {dateFormat.format(revision.createdAt)}
                  </div>
                </div>
                {canRestore ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate({ id: pageId, version: revision.version })}
                  >
                    Wiederherstellen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
