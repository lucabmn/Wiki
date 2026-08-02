import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { externalUrlHost, normalizeExternalUrl } from "@nilovon-wiki/api/lib/external-url";
import type { ExternalLink } from "@nilovon-wiki/api/schemas/external-link";
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
import { Label } from "@nilovon-wiki/ui/components/label";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLinkIcon, Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

/** The dialog edits an existing link, or creates one when nothing is selected. */
type Draft = { link: ExternalLink | null };

/**
 * A page's curated external links: the specs, tickets and vendor docs that
 * belong next to an article without living inside its body. Editors add, edit,
 * reorder and remove them; everyone else sees the list — and readers of a page
 * that has none see nothing at all, like the attachments section.
 *
 * Order is manual (arrow buttons) rather than alphabetical: these lists are
 * short and usually have a "read this first" entry.
 */
export function PageExternalLinks({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const listOptions = orpc.externalLinks.list.queryOptions({ input: { pageId } });
  const { data: links } = useQuery(listOptions);
  const [draft, setDraft] = useState<Draft | null>(null);

  // Every mutation answers with the page's new list, so the cache can be seeded
  // from the response instead of waiting on a refetch — which matters for the
  // move buttons, where a refetch would let rows visibly jump back and forth.
  const applyResult = (next: ExternalLink[]) => {
    queryClient.setQueryData(listOptions.queryKey, next);
  };

  const move = useMutation(
    orpc.externalLinks.move.mutationOptions({ onSuccess: applyResult, onError: toastError }),
  );
  const remove = useMutation(
    orpc.externalLinks.delete.mutationOptions({ onSuccess: applyResult, onError: toastError }),
  );

  const items = links ?? [];
  if (!items.length && !canEdit) return null;

  const busy = move.isPending || remove.isPending;

  return (
    <section aria-labelledby="page-external-links-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2
          id="page-external-links-heading"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Globe className="size-4 text-muted-foreground" />
          Externe Links
          {items.length ? (
            <span className="font-normal text-muted-foreground">({items.length})</span>
          ) : null}
        </h2>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setDraft({ link: null })}>
            <Plus className="size-4" /> Link hinzufügen
          </Button>
        ) : null}
      </div>

      {items.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((link, index) => (
            <li key={link.id} className="flex items-start gap-3 p-3">
              <ExternalLinkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={link.url}
                  target="_blank"
                  // `noopener` keeps the opened tab from reaching back into this
                  // one via `window.opener`; `noreferrer` keeps internal wiki
                  // URLs out of the target site's referrer log.
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:underline"
                >
                  {link.title}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {externalUrlHost(link.url)}
                </p>
                {link.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${link.title} nach oben`}
                    disabled={busy || index === 0}
                    onClick={() => move.mutate({ id: link.id, direction: "up" })}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${link.title} nach unten`}
                    disabled={busy || index === items.length - 1}
                    onClick={() => move.mutate({ id: link.id, direction: "down" })}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${link.title} bearbeiten`}
                    onClick={() => setDraft({ link })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${link.title} entfernen`}
                    disabled={busy}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove.mutate({ id: link.id })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Noch keine externen Links.</p>
      )}

      {canEdit && draft ? (
        <ExternalLinkDialog
          pageId={pageId}
          link={draft.link}
          onDone={applyResult}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Add/edit form. Mounted only while open (keyed by the caller's draft state) so
 * the fields reset between links without an effect syncing props into state.
 */
function ExternalLinkDialog({
  pageId,
  link,
  onDone,
  onClose,
}: {
  pageId: string;
  link: ExternalLink | null;
  onDone: (links: ExternalLink[]) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(link?.url ?? "");
  const [title, setTitle] = useState(link?.title ?? "");
  const [description, setDescription] = useState(link?.description ?? "");

  const finish = (links: ExternalLink[]) => {
    onDone(links);
    onClose();
  };
  const create = useMutation(
    orpc.externalLinks.create.mutationOptions({ onSuccess: finish, onError: toastError }),
  );
  const update = useMutation(
    orpc.externalLinks.update.mutationOptions({ onSuccess: finish, onError: toastError }),
  );

  // The server normalizes and re-validates; doing it here too turns a rejected
  // round-trip into an inline hint, and lets the title default to the host.
  const normalized = normalizeExternalUrl(url);
  const invalidUrl = url.trim().length > 0 && normalized === null;
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (!normalized) return;
    const payload = {
      url: normalized,
      title: title.trim() || externalUrlHost(normalized),
      description: description.trim() || null,
    };
    if (link) update.mutate({ id: link.id, ...payload });
    else create.mutate({ pageId, ...payload });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{link ? "Link bearbeiten" : "Externen Link hinzufügen"}</DialogTitle>
          <DialogDescription>
            Verweise auf Quellen außerhalb des Wikis — Spezifikationen, Tickets, Hersteller-Doku.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="external-link-url">URL</Label>
            <Input
              id="external-link-url"
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/docs"
              aria-invalid={invalidUrl}
              aria-describedby={invalidUrl ? "external-link-url-error" : undefined}
            />
            {invalidUrl ? (
              <p id="external-link-url-error" className="text-xs text-destructive">
                Nur vollständige http- oder https-Adressen sind erlaubt.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="external-link-title">Titel</Label>
            <Input
              id="external-link-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={normalized ? externalUrlHost(normalized) : "Anzeigename"}
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="external-link-description">Beschreibung (optional)</Label>
            <Textarea
              id="external-link-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Wofür ist dieser Link gut?"
              rows={2}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending || !normalized}>
              {pending ? "Speichern …" : link ? "Speichern" : "Hinzufügen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
