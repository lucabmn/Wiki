import { externalUrlHost, normalizeExternalUrl } from "@nilovon-wiki/api/lib/external-url";
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
import { useState } from "react";

/**
 * Prompts for an external URL to link from the page body.
 *
 * The URL goes through the same normalizer the API uses for a page's curated
 * link list (`@nilovon-wiki/api/lib/external-url`), so both paths that build an
 * href from user input enforce one scheme allowlist — the editor never produces
 * a `javascript:` link for TipTap's own URI validation to catch later.
 *
 * `initialUrl` pre-fills the field when the caret sits inside an existing link,
 * making this the edit dialog too. `showText` is off while text is selected:
 * there the selection already supplies the link's label.
 */
export function ExternalLinkDialog({
  open,
  onOpenChange,
  initialUrl,
  showText,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl?: string | null;
  showText: boolean;
  onSubmit: (link: { href: string; text: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  // Reset from props each time the dialog opens rather than syncing in an
  // effect: `key` remounts nothing here, and a stale URL from the previously
  // edited link is worse than an extra render.
  const [seed, setSeed] = useState<string | null>(null);
  const currentSeed = open ? (initialUrl ?? "") : null;
  if (seed !== currentSeed) {
    setSeed(currentSeed);
    setUrl(currentSeed ?? "");
    setText("");
  }

  const normalized = normalizeExternalUrl(url);
  const invalid = url.trim().length > 0 && normalized === null;

  const submit = () => {
    if (!normalized) return;
    onSubmit({ href: normalized, text: text.trim() || externalUrlHost(normalized) });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Externer Link</DialogTitle>
          <DialogDescription>
            Verlinkt auf eine Adresse außerhalb des Wikis. Für Seiten in diesem Space gibt es „Seite
            verknüpfen“.
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
            <Label htmlFor="editor-external-url">URL</Label>
            <Input
              id="editor-external-url"
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              aria-invalid={invalid}
              aria-describedby={invalid ? "editor-external-url-error" : undefined}
            />
            {invalid ? (
              <p id="editor-external-url-error" className="text-xs text-destructive">
                Nur vollständige http- oder https-Adressen sind erlaubt.
              </p>
            ) : null}
          </div>
          {showText ? (
            <div className="space-y-1.5">
              <Label htmlFor="editor-external-text">Linktext (optional)</Label>
              <Input
                id="editor-external-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={normalized ? externalUrlHost(normalized) : "Angezeigter Text"}
                maxLength={300}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={!normalized}>
              Einfügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
