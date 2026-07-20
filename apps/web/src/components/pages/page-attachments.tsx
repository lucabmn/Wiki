import { toastError } from "@/lib/query";
import { friendlyErrorMessage, orpc } from "@/utils/orpc";
import { env } from "@nilovon-wiki/env/web";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@nilovon-wiki/ui/components/attachment";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Spinner } from "@nilovon-wiki/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

/** Bytes are proxied by the API server, never fetched from the bucket directly. */
const attachmentUrl = (id: string) => `${env.VITE_SERVER_URL}/attachments/${id}/download`;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * Attachments of a page: list, upload, download, delete.
 *
 * Upload goes to the server's multipart route rather than through oRPC — an RPC
 * envelope cannot carry file bytes — so this is the one place in the web app
 * that talks to the API with a plain `fetch`. `credentials: "include"` is
 * required: the session lives in a cookie and the API is a different origin.
 */
export function PageAttachments({
  pageId,
  spaceId,
  canEdit,
}: {
  pageId: string;
  spaceId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const listOptions = orpc.attachments.list.queryOptions({ input: { pageId } });
  const { data: attachments } = useQuery(listOptions);

  const remove = useMutation(
    orpc.attachments.delete.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.attachments.list.key() }),
      onError: toastError,
    }),
  );

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("spaceId", spaceId);
      body.set("pageId", pageId);
      const response = await fetch(`${env.VITE_SERVER_URL}/attachments/upload`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Upload fehlgeschlagen");
      }
      await queryClient.invalidateQueries({ queryKey: orpc.attachments.list.key() });
      toast.success(`${file.name} hochgeladen`);
    } catch (error) {
      toast.error(friendlyErrorMessage(error as Error));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const items = attachments ?? [];
  if (!items.length && !canEdit) return null;

  return (
    <section aria-labelledby="page-attachments-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="page-attachments-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="size-4 text-muted-foreground" />
          Anhänge
          {items.length ? (
            <span className="text-muted-foreground font-normal">({items.length})</span>
          ) : null}
        </h2>
        {canEdit ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label="Datei auswählen"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Spinner /> : <Upload className="size-4" />}
              {uploading ? "Wird hochgeladen …" : "Datei hinzufügen"}
            </Button>
          </>
        ) : null}
      </div>

      {items.length ? (
        <AttachmentGroup>
          {items.map((item) => (
            <Attachment key={item.id}>
              <AttachmentMedia>
                <FileText />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{item.fileName}</AttachmentTitle>
                <AttachmentDescription>{formatSize(item.size)}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  nativeButton={false}
                  render={
                    <a
                      href={attachmentUrl(item.id)}
                      aria-label={`${item.fileName} herunterladen`}
                      download={item.fileName}
                    >
                      <Download />
                    </a>
                  }
                />
                {canEdit ? (
                  <AttachmentAction
                    aria-label={`${item.fileName} löschen`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: item.id })}
                  >
                    <Trash2 />
                  </AttachmentAction>
                ) : null}
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      ) : (
        <p className="text-sm text-muted-foreground">Noch keine Anhänge.</p>
      )}
    </section>
  );
}
