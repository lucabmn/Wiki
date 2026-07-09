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
import { ArrowLeft, Eye, History } from "lucide-react";
import { useState } from "react";

import { PageContent } from "./page-content";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Version history for a page. Lists the immutable revisions snapshotted at each
 * publish. A revision can be *viewed* read-only (no side effects) or, for a
 * permitted user, restored via `pages.restoreRevision` (same authorization the
 * server enforces).
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
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);

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

  const preview = revisions?.find((r) => r.version === previewVersion) ?? null;

  const close = (next: boolean) => {
    if (!next) setPreviewVersion(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={preview ? "sm:max-w-3xl" : undefined}>
        {preview ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Zurück"
                  onClick={() => setPreviewVersion(null)}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <DialogTitle>
                  Version {preview.version} · {preview.title}
                </DialogTitle>
              </div>
              <DialogDescription>
                Nur-Lese-Vorschau vom {dateFormat.format(preview.createdAt)}. Die aktuelle Seite
                bleibt unverändert.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border p-4">
              <PageContent content={preview.content} fallbackText={preview.textContent} />
            </div>
            {canRestore ? (
              <div className="flex justify-end">
                <Button
                  disabled={restore.isPending}
                  onClick={() => restore.mutate({ id: pageId, version: preview.version })}
                >
                  Diese Version wiederherstellen
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Versionsverlauf</DialogTitle>
              <DialogDescription>
                Jede Veröffentlichung legt eine Version ab. Ansehen ändert nichts; Wiederherstellen
                setzt die Seite auf die Version zurück.
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
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewVersion(revision.version)}
                      >
                        <Eye className="size-4" /> Ansehen
                      </Button>
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
