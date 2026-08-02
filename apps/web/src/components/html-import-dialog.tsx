import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileCode2,
  FolderUp,
  Image as ImageIcon,
  Paperclip,
  Upload,
  X,
} from "lucide-react";

import {
  prepareHtmlMigration,
  type HtmlImportPreview,
  type HtmlMigrationAsset,
} from "@/lib/html-import";
import { useInvalidate } from "@/lib/query";
import { client, orpc } from "@/utils/orpc";
import { env } from "@nilovon-wiki/env/web";
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

type ImportResult = Awaited<ReturnType<typeof client.pages.import>>;

async function responseAttachmentId(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
  } | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.message ?? "Asset-Upload fehlgeschlagen");
  }
  return payload.id;
}

async function uploadMigrationAsset(
  asset: HtmlMigrationAsset,
  spaceId: string,
  pageId: string,
): Promise<string> {
  if (asset.file) {
    const body = new FormData();
    body.set("file", asset.file, asset.fileName);
    body.set("spaceId", spaceId);
    body.set("pageId", pageId);
    return responseAttachmentId(
      await fetch(`${env.VITE_SERVER_URL}/attachments/upload`, {
        method: "POST",
        credentials: "include",
        body,
      }),
    );
  }
  throw new Error(`Asset „${asset.sourcePath}“ ist nicht lokal verfügbar.`);
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
  const createdRef = useRef<ImportResult | null>(null);
  const uploadedRef = useRef(new Map<string, string>());
  const publishedRef = useRef(new Set<string>());
  const [pages, setPages] = useState<HtmlImportPreview[]>([]);
  const [assets, setAssets] = useState<HtmlMigrationAsset[]>([]);
  const [ignoredFiles, setIgnoredFiles] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const invalidatePages = useInvalidate(orpc.pages.list.key());

  const commit = useMutation({
    mutationFn: async () => {
      let created = createdRef.current;
      if (!created) {
        if (assets.length) {
          const capabilities = await client.attachments.capabilities({});
          if (!capabilities.enabled) {
            throw new Error(
              "Die Migration enthält Assets, aber der S3-kompatible Attachment-Speicher ist nicht konfiguriert.",
            );
          }
          const oversized = assets.find(
            (asset) => asset.file && asset.file.size > capabilities.maxUploadBytes,
          );
          if (oversized) {
            throw new Error(
              `„${oversized.fileName}“ überschreitet das Upload-Limit von ${Math.round(capabilities.maxUploadBytes / 1024 / 1024)} MB.`,
            );
          }
        }
        created = await client.pages.import({
          spaceId,
          // Pages with assets stay private drafts until every object is uploaded
          // and every placeholder is finalized; readers never see a half-migrated page.
          status: status === "published" && assets.length ? "draft" : status,
          pages: pages.map(({ warnings: _warnings, ...page }) => page),
        });
        createdRef.current = created;
        setProgress(20);
      }

      const pageIds = new Map(created.imported.map((page) => [page.key, page.id]));
      const selectedPageKeys = new Set(pages.map((page) => page.key));
      const jobs = assets.flatMap((asset) =>
        asset.references
          .filter((reference) => selectedPageKeys.has(reference.pageKey))
          .map((reference) => ({ asset, pageKey: reference.pageKey })),
      );
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index]!;
        const pageId = pageIds.get(job.pageKey);
        if (!pageId) continue;
        const uploadKey = `${pageId}|${job.asset.placeholder}`;
        if (!uploadedRef.current.has(uploadKey)) {
          const attachmentId = await uploadMigrationAsset(job.asset, spaceId, pageId);
          uploadedRef.current.set(uploadKey, attachmentId);
        }
        setProgress(20 + Math.round(((index + 1) / Math.max(jobs.length, 1)) * 70));
      }

      if (jobs.length) {
        const mappings = new Map<string, Array<{ placeholder: string; attachmentId: string }>>();
        for (const job of jobs) {
          const pageId = pageIds.get(job.pageKey);
          if (!pageId) continue;
          const attachmentId = uploadedRef.current.get(`${pageId}|${job.asset.placeholder}`);
          if (!attachmentId) continue;
          const current = mappings.get(pageId) ?? [];
          if (!current.some((item) => item.placeholder === job.asset.placeholder)) {
            current.push({ placeholder: job.asset.placeholder, attachmentId });
          }
          mappings.set(pageId, current);
        }
        await client.pages.finalizeImportAssets({
          pages: [...mappings].map(([id, pageAssets]) => ({ id, assets: pageAssets })),
        });
      }
      if (status === "published" && assets.length) {
        for (const imported of created.imported) {
          if (!publishedRef.current.has(imported.id)) {
            await client.pages.publish({
              id: imported.id,
              summary: "HTML-Migration mit Assets abgeschlossen",
            });
            publishedRef.current.add(imported.id);
          }
        }
      }
      setProgress(100);
      return created;
    },
    onSuccess: () => invalidatePages(),
    onError: (nextError) => setError(errorMessage(nextError)),
  });

  useEffect(() => {
    if (!open) {
      setPages([]);
      setAssets([]);
      setIgnoredFiles([]);
      setError(null);
      setConfirmed(false);
      setStatus("draft");
      setProgress(0);
      createdRef.current = null;
      uploadedRef.current.clear();
      publishedRef.current.clear();
      commit.reset();
    }
  }, [open]);

  const selectFiles = async (files: File[]) => {
    setParsing(true);
    setError(null);
    setConfirmed(false);
    createdRef.current = null;
    uploadedRef.current.clear();
    publishedRef.current.clear();
    try {
      const bundle = await prepareHtmlMigration(files);
      setPages(bundle.pages);
      setAssets(bundle.assets);
      setIgnoredFiles(bundle.ignoredFiles);
    } catch (nextError) {
      setPages([]);
      setAssets([]);
      setIgnoredFiles([]);
      setError(errorMessage(nextError));
    } finally {
      setParsing(false);
    }
  };

  const warningCount =
    pages.reduce((total, page) => total + page.warnings.length, 0) + ignoredFiles.length;
  const imageCount = assets.filter((asset) =>
    asset.references.some((reference) => reference.kind === "image"),
  ).length;
  const attachmentCount = assets.length - imageCount;

  return (
    <Dialog open={open} onOpenChange={(next) => !commit.isPending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>HTML-Wiki migrieren</DialogTitle>
          <DialogDescription>
            Importiere Seiten, Bilder und verlinkte Dateien aus Drupal oder anderen Wikis. Vor dem
            Schreiben erhältst du eine vollständige Vorschau.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex items-center gap-3 text-xs text-muted-foreground"
          aria-label="Import-Fortschritt"
        >
          <span className={pages.length ? "text-primary" : "font-medium text-foreground"}>
            1 · Export
          </span>
          <Progress
            value={commit.isPending ? progress : commit.isSuccess ? 100 : pages.length ? 50 : 5}
            className="h-1.5"
          />
          <span
            className={
              commit.isSuccess ? "text-primary" : pages.length ? "font-medium text-foreground" : ""
            }
          >
            {commit.isSuccess ? "3 · Fertig" : commit.isPending ? "3 · Übertragen" : "2 · Prüfen"}
          </span>
        </div>

        {commit.isSuccess ? (
          <div className="space-y-4 py-5 text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <div>
              <h3 className="font-semibold">Migration abgeschlossen</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {commit.data.imported.length} Seiten und {assets.length} Assets wurden importiert.
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
              <p className="font-medium">Kompletten Export hier ablegen</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Wähle HTML-Seiten zusammen mit ihren Bildern und Downloads. Mit „Ordner wählen“
                bleiben relative Drupal-Pfade erhalten.
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
                  <FolderUp className="size-4" /> Export-Ordner wählen
                </Button>
              </div>
            </div>
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              multiple
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.currentTarget.value = "";
                void selectFiles(files);
              }}
            />
            <input
              ref={directoryRef}
              className="hidden"
              type="file"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.currentTarget.value = "";
                void selectFiles(files);
              }}
            />
            {parsing ? (
              <p className="text-center text-sm text-muted-foreground">
                Seiten und Assets werden analysiert …
              </p>
            ) : null}
          </div>
        ) : (
          <div className="min-h-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Migration bereit zur Prüfung</p>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileCode2 className="size-3.5" /> {pages.length} Seiten
                  </span>
                  <span className="flex items-center gap-1">
                    <ImageIcon className="size-3.5" /> {imageCount} Bilder
                  </span>
                  <span className="flex items-center gap-1">
                    <Paperclip className="size-3.5" /> {attachmentCount} Anhänge
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={createdRef.current !== null}
                onClick={() => inputRef.current?.click()}
              >
                Auswahl ändern
              </Button>
            </div>

            {warningCount > 0 ? (
              <Alert>
                <AlertCircle />
                <AlertTitle>{warningCount} Hinweise</AlertTitle>
                <AlertDescription>
                  Fehlende Assets werden gekennzeichnet; technische Export-Dateien wie CSS,
                  JavaScript oder Fonts werden nicht als Wiki-Anhänge übernommen.
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
                        disabled={createdRef.current !== null}
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
                      disabled={createdRef.current !== null}
                      onClick={() => {
                        setPages((current) =>
                          current
                            .filter((_, itemIndex) => itemIndex !== index)
                            .map((item) =>
                              item.parentKey === page.key ? { ...item, parentKey: null } : item,
                            ),
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
                  disabled={createdRef.current !== null}
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
                <span className="font-medium text-foreground">Vollständige Übernahme</span>
                <br />
                Lokale und eingebettete Bilder werden als geschützte Attachments gespeichert.
                Externe Bilder bleiben aus Sicherheitsgründen verlinkt oder werden markiert.
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
                Ich habe Seiten, Assets und Hinweise geprüft und möchte die Migration starten.
              </span>
            </label>
          </div>
        )}

        {commit.isPending ? (
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {progress < 20
              ? "Seiten werden angelegt …"
              : progress < 90
                ? `Assets werden übertragen … ${progress}%`
                : "Verknüpfungen werden finalisiert …"}
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Migration unterbrochen</AlertTitle>
            <AlertDescription>
              {error} Bereits übertragene Daten bleiben für einen sicheren erneuten Versuch
              erhalten.
            </AlertDescription>
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
                  commit.mutate();
                }}
              >
                {commit.isPending
                  ? "Migration läuft …"
                  : `${pages.length} Seiten + ${assets.length} Assets migrieren`}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
