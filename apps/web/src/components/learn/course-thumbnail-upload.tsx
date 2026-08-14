import { toastError, useInvalidate } from "@/lib/query";
import { friendlyErrorMessage, orpc } from "@/utils/orpc";
import type { CourseCard } from "@nilovon-wiki/api/schemas/course";
import { env } from "@nilovon-wiki/env/web";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Spinner } from "@nilovon-wiki/ui/components/spinner";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImageOff, ImagePlus, Info, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** What the multipart route answers with; only the id is load-bearing here. */
type UploadedAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
};

/**
 * Sends one file to the course-asset route and returns the stored row.
 *
 * Uploads bypass oRPC for the same reason page attachments do — an RPC envelope
 * cannot carry bytes — so this is the builder's only plain `fetch`.
 * `credentials: "include"` is required: the session is a cookie and the API is a
 * different origin. Lives here rather than in a shared module because the two
 * callers (this component and the lesson editor) are both mine, and the strict
 * file scope of this feature has no seventh file to put it in.
 */
export async function uploadCourseAsset({
  courseId,
  kind,
  file,
}: {
  courseId: string;
  kind: "thumbnail" | "video" | "document" | "other";
  file: File;
}): Promise<UploadedAsset> {
  const body = new FormData();
  body.set("file", file, file.name);
  body.set("courseId", courseId);
  body.set("kind", kind);

  const response = await fetch(`${env.VITE_SERVER_URL}/course-assets/upload`, {
    method: "POST",
    credentials: "include",
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<UploadedAsset> & { message?: string })
    | null;
  if (!response.ok || !payload?.id) {
    // The route already answers in German for the cases an author can cause
    // (too large, wrong kind), so its message beats a generic one.
    throw new Error(payload?.message ?? "Upload fehlgeschlagen");
  }
  return payload as UploadedAsset;
}

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif)$/i;

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString("de-DE", { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/**
 * The course's catalog image: drop or pick a file, upload it as a course asset,
 * then point the course at it.
 *
 * Two steps rather than one because the API keeps them apart: the bytes go to
 * the multipart route, and `courses.update({ thumbnailAssetId })` is what makes
 * the resulting asset *this course's* thumbnail. Object storage is optional in a
 * self-hosted install, so `assets.capabilities` is asked first — without it the
 * upload would fail at the very end, after the author picked a file.
 */
export function CourseThumbnailUpload({
  course,
  disabled = false,
}: {
  course: CourseCard;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const invalidateCourses = useInvalidate(orpc.learn.courses.key());

  const capabilities = useQuery(orpc.learn.assets.capabilities.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.learn.courses.update.mutationOptions({
      onSuccess: () => invalidateCourses(),
      onError: toastError,
    }),
  );

  const storageEnabled = capabilities.data?.enabled ?? false;
  const maxBytes = capabilities.data?.maxUploadBytes ?? 0;
  const busy = uploading || update.isPending;
  const locked = disabled || !storageEnabled;

  const handleFile = async (file: File) => {
    if (!IMAGE_TYPES.test(file.type)) {
      toast.error("Bitte ein Bild im Format PNG, JPEG, GIF, WebP oder AVIF wählen.");
      return;
    }
    if (maxBytes && file.size > maxBytes) {
      toast.error(`Das Bild ist größer als ${formatSize(maxBytes)}.`);
      return;
    }
    setUploading(true);
    try {
      const asset = await uploadCourseAsset({ courseId: course.id, kind: "thumbnail", file });
      await update.mutateAsync({ id: course.id, thumbnailAssetId: asset.id });
      toast.success("Kursbild aktualisiert");
    } catch (error) {
      toast.error(friendlyErrorMessage(error as Error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Kursbild</h3>
        <p className="text-muted-foreground text-xs">
          Wird im Katalog und über dem Kurs angezeigt. Querformat (3:1) sieht am besten aus.
        </p>
      </div>

      {capabilities.isSuccess && !storageEnabled ? (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Dateispeicher ist nicht eingerichtet</AlertTitle>
          <AlertDescription>
            Ohne konfigurierten Objektspeicher können keine Bilder hochgeladen werden. Die übrigen
            Kurseinstellungen funktionieren weiterhin.
          </AlertDescription>
        </Alert>
      ) : null}

      {course.thumbnailUrl ? (
        <div className="space-y-2">
          <div className="bg-muted aspect-[3/1] overflow-hidden rounded-lg">
            <img
              src={course.thumbnailUrl}
              alt="Aktuelles Kursbild"
              className="size-full object-cover"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked || busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <Spinner /> : <ImagePlus className="size-4" aria-hidden />}
              Ersetzen
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy}
              onClick={() => update.mutate({ id: course.id, thumbnailAssetId: null })}
            >
              <Trash2 className="size-4" aria-hidden />
              Entfernen
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={locked || busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            if (locked || busy) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (locked || busy) return;
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            "text-muted-foreground flex aspect-[3/1] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm transition-colors",
            !locked && !busy && "hover:border-primary/60 hover:text-foreground",
            dragging && "border-primary text-foreground",
            (locked || busy) && "cursor-not-allowed opacity-60",
          )}
        >
          {busy ? <Spinner /> : locked ? <ImageOff aria-hidden /> : <ImagePlus aria-hidden />}
          <span>
            {busy ? "Wird hochgeladen …" : "Bild hierher ziehen oder klicken zum Auswählen"}
          </span>
          {maxBytes ? <span className="text-xs">Maximal {formatSize(maxBytes)}</span> : null}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        className="sr-only"
        aria-label="Kursbild auswählen"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </Card>
  );
}
