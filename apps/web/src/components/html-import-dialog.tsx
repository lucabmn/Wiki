import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FileCode2, FolderUp, Upload, X } from "lucide-react";

import { parseHtmlFiles, type HtmlImportPreview } from "@/lib/html-import";
import { useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { ScrollArea } from "@nilovon-wiki/ui/components/scroll-area";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Der Import ist fehlgeschlagen.";
}

export function HtmlImportDialog({
  open,
  onOpenChange,
  spaceId,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  onComplete?: (firstPageId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<HtmlImportPreview[]>([]);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [confirmed, setConfirmed] = useState(false);
  const invalidatePages = useInvalidate(orpc.pages.list.key());

  const commit = useMutation(
    orpc.pages.import.mutationOptions({
      onSuccess: () => {
        invalidatePages();
      },
      onError: (nextError) => setError(errorMessage(nextError)),
    }),
  );

  useEffect(() => {
    if (!open) {
      setPages([]);
      setError(null);
      setConfirmed(false);
      setStatus("draft");
      commit.reset();
    }
  }, [open]);

  const selectFiles = async (files: File[]) => {
    setParsing(true);
    setError(null);
    setConfirmed(false);
    try {
      setPages(await parseHtmlFiles(files));
    } catch (nextError) {
      setPages([]);
      setError(errorMessage(nextError));
    } finally {
      setParsing(false);
    }
  };

  const warningCount = pages.reduce((total, page) => total + page.warnings.length, 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !commit.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>HTML-Seiten importieren</DialogTitle>
          <DialogDescription>
            Migriere exportierte Seiten aus Drupal oder anderen Wikis. Du prüfst alles, bevor Seiten
            angelegt werden.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex items-center gap-3 text-xs text-muted-foreground"
          aria-label="Import-Fortschritt"
        >
          <span className={pages.length ? "text-primary" : "font-medium text-foreground"}>
            1 · Dateien
          </span>
          <Progress value={commit.isSuccess ? 100 : pages.length ? 55 : 10} className="h-1.5" />
          <span
            className={
              commit.isSuccess ? "text-primary" : pages.length ? "font-medium text-foreground" : ""
            }
          >
            {commit.isSuccess ? "3 · Fertig" : "2 · Prüfen"}
          </span>
        </div>

        {commit.isSuccess ? (
          <div className="space-y-4 py-5 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <div>
              <h3 className="font-semibold">Migration abgeschlossen</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {commit.data.imported.length}{" "}
                {commit.data.imported.length === 1 ? "Seite wurde" : "Seiten wurden"} sicher
                importiert.
              </p>
            </div>
            <Button onClick={() => onComplete?.(commit.data.imported[0]!.id)}>
              Erste Seite öffnen
            </Button>
          </div>
        ) : pages.length === 0 ? (
          <div className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(event) => event.key === "Enter" && inputRef.current?.click()}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void selectFiles([...event.dataTransfer.files]);
              }}
              className={`flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
            >
              <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Upload className="size-6" />
              </span>
              <p className="font-medium">HTML-Dateien hier ablegen</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Einzelne oder mehrere .html/.htm-Dateien, maximal 100 Dateien und 2 MB pro Datei.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  <FileCode2 className="size-4" /> Dateien wählen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    directoryRef.current?.click();
                  }}
                >
                  <FolderUp className="size-4" /> Ordner wählen
                </Button>
              </div>
            </div>
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept=".html,.htm,text/html"
              multiple
              onChange={(event) => void selectFiles([...(event.target.files ?? [])])}
            />
            <input
              ref={directoryRef}
              className="hidden"
              type="file"
              accept=".html,.htm,text/html"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => void selectFiles([...(event.target.files ?? [])])}
            />
            {parsing ? (
              <p className="text-center text-sm text-muted-foreground">
                Dateien werden analysiert …
              </p>
            ) : null}
          </div>
        ) : (
          <div className="min-h-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{pages.length} Seiten bereit</p>
                <p className="text-xs text-muted-foreground">
                  Titel und erkannte Hinweise kannst du vor dem Import prüfen.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                Auswahl ändern
              </Button>
            </div>

            {warningCount > 0 ? (
              <Alert>
                <AlertCircle />
                <AlertTitle>{warningCount} Hinweise</AlertTitle>
                <AlertDescription>
                  Bilder, eingebettete Inhalte und unsichere Links werden bewusst nicht übernommen.
                </AlertDescription>
              </Alert>
            ) : null}

            <ScrollArea className="h-64 rounded-lg border">
              <div className="divide-y">
                {pages.map((page, index) => (
                  <div key={page.key} className="flex items-start gap-3 p-3">
                    <FileCode2 className="mt-2 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Input
                        value={page.title}
                        maxLength={300}
                        aria-label={`Titel für ${page.sourcePath}`}
                        onChange={(event) => {
                          const title = event.target.value;
                          setPages((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, title } : item,
                            ),
                          );
                          setConfirmed(false);
                        }}
                      />
                      <p className="truncate text-xs text-muted-foreground">{page.sourcePath}</p>
                      {page.warnings.map((warning) => (
                        <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">
                          • {warning}
                        </p>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${page.title} entfernen`}
                      onClick={() => {
                        setPages((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        );
                        setConfirmed(false);
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="import-status" className="mb-1.5 block text-sm font-medium">
                  Nach dem Import
                </label>
                <NativeSelect
                  id="import-status"
                  className="w-full"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as "draft" | "published");
                    setConfirmed(false);
                  }}
                >
                  <NativeSelectOption value="draft">Als Entwürfe speichern</NativeSelectOption>
                  <NativeSelectOption value="published">Direkt veröffentlichen</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Sicherer Import</span>
                <br />
                Scripts, Styles und aktive Inhalte werden entfernt. Originaldateien bleiben
                unverändert.
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                Ich habe die Vorschau geprüft und möchte {pages.length}{" "}
                {pages.length === 1 ? "Seite" : "Seiten"}{" "}
                {status === "draft" ? "als Entwürfe" : "veröffentlicht"} anlegen.
              </span>
            </label>
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Import nicht möglich</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!commit.isSuccess ? (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={commit.isPending}
            >
              Abbrechen
            </Button>
            {pages.length ? (
              <Button
                disabled={
                  !confirmed || commit.isPending || pages.some((page) => !page.title.trim())
                }
                onClick={() => {
                  setError(null);
                  commit.mutate({
                    spaceId,
                    status,
                    pages: pages.map(({ warnings: _warnings, ...page }) => page),
                  });
                }}
              >
                {commit.isPending
                  ? "Seiten werden importiert …"
                  : `${pages.length} ${pages.length === 1 ? "Seite" : "Seiten"} importieren`}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
