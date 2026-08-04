import { useEffect, useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { orpc, client } from "@/utils/orpc";
import { toastError } from "@/lib/query";
import { CopyField } from "./copy-field";
import { WebhookEventPicker } from "./webhook-event-picker";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Switch } from "@nilovon-wiki/ui/components/switch";

export type Webhook = Awaited<ReturnType<typeof client.webhooks.list>>[number];
/** The action union, taken from the server rather than restated here. */
export type WebhookEvent = Webhook["events"][number];

type Draft = {
  name: string;
  url: string;
  spaceId: string;
  events: WebhookEvent[];
  active: boolean;
};

const EMPTY: Draft = { name: "", url: "", spaceId: "", events: [], active: true };

/**
 * Creates a webhook, or edits an existing one.
 *
 * Two things make this more than a form. The **secret is shown exactly once** —
 * it is stored to sign requests with, not to be read back — so creation ends on
 * a hand-off screen rather than closing silently. And the **event list is
 * fetched from the server** instead of hard-coded here: the set of deliverable
 * actions is a server-side decision (webhook administration is audited but not
 * deliverable), and a client-side copy would drift.
 */
export function WebhookDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create. */
  existing: Webhook | null;
  onSaved: () => Promise<void> | void;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const eventsQuery = useQuery(orpc.webhooks.listEvents.queryOptions({ input: {}, enabled: open }));
  const spacesQuery = useQuery(orpc.spaces.list.queryOptions({ input: {}, enabled: open }));

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSecret(null);
    setDraft(
      existing
        ? {
            name: existing.name,
            url: existing.url,
            spaceId: existing.spaceId ?? "",
            events: [...existing.events],
            active: existing.active,
          }
        : EMPTY,
    );
  }, [open, existing]);

  const patch = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));

  const save = useMutation({
    mutationFn: async (values: Draft) => {
      const input = {
        name: values.name.trim(),
        url: values.url.trim(),
        events: values.events,
        spaceId: values.spaceId || null,
        active: values.active,
      };
      return existing
        ? { ...(await client.webhooks.update({ id: existing.id, ...input })), secret: null }
        : await client.webhooks.create(input);
    },
    onSuccess: async (result) => {
      await onSaved();
      if (result.secret) {
        // Creation: stay open on the hand-off screen — closing here would lose
        // the only copy of the secret.
        setSecret(result.secret);
        return;
      }
      toast.success("Webhook gespeichert");
      onOpenChange(false);
    },
    onError: toastError,
  });

  const submit = () => {
    if (!draft.name.trim()) return setError("Bitte einen Namen vergeben.");
    if (!/^https?:\/\/.+/i.test(draft.url.trim())) {
      return setError("Die URL muss mit http:// oder https:// beginnen.");
    }
    if (draft.events.length === 0) return setError("Mindestens ein Ereignis auswählen.");
    setError(null);
    save.mutate(draft);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSecret(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {secret ? (
          <SecretHandoff secret={secret} onDone={() => onOpenChange(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{existing ? "Webhook bearbeiten" : "Webhook hinzufügen"}</DialogTitle>
              <DialogDescription>
                Wir schicken bei jedem ausgewählten Ereignis ein JSON-Objekt per POST an diese
                Adresse — signiert, damit der Empfänger die Herkunft prüfen kann.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
              <Field>
                <FieldLabel htmlFor={`${fieldId}-name`}>Name</FieldLabel>
                <Input
                  id={`${fieldId}-name`}
                  value={draft.name}
                  placeholder="Slack #wiki"
                  onChange={(event) => patch({ name: event.target.value })}
                />
                <FieldDescription>Nur für euch — steht so in der Liste.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor={`${fieldId}-url`}>Ziel-URL</FieldLabel>
                <Input
                  id={`${fieldId}-url`}
                  type="url"
                  inputMode="url"
                  value={draft.url}
                  placeholder="https://automat.example.com/wiki"
                  onChange={(event) => patch({ url: event.target.value })}
                />
                <FieldDescription>
                  Muss von außen erreichbar sein. Adressen im internen Netz werden abgelehnt.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor={`${fieldId}-space`}>Space</FieldLabel>
                <NativeSelect
                  id={`${fieldId}-space`}
                  className="w-full"
                  value={draft.spaceId}
                  onChange={(event) => patch({ spaceId: event.target.value })}
                >
                  <NativeSelectOption value="">Alle Spaces</NativeSelectOption>
                  {(spacesQuery.data ?? []).map((space) => (
                    <NativeSelectOption key={space.id} value={space.id}>
                      {space.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  „Alle Spaces" schließt später angelegte Spaces mit ein.
                </FieldDescription>
              </Field>

              <div className="space-y-2">
                <span className="text-sm font-medium">Ereignisse</span>
                {eventsQuery.isPending ? (
                  <Skeleton className="h-40 w-full rounded-lg" />
                ) : (
                  <WebhookEventPicker
                    available={eventsQuery.data ?? []}
                    selected={draft.events}
                    onChange={(events) => patch({ events })}
                    idPrefix={fieldId}
                    disabled={save.isPending}
                  />
                )}
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                <label htmlFor={`${fieldId}-active`} className="min-w-0 cursor-pointer">
                  <span className="block text-sm font-medium">Aktiv</span>
                  <span className="block text-xs text-muted-foreground">
                    Pausiert werden keine Ereignisse zugestellt — auch keine nachträglich.
                  </span>
                </label>
                <Switch
                  id={`${fieldId}-active`}
                  className="mt-0.5 shrink-0"
                  checked={draft.active}
                  onCheckedChange={(next) => patch({ active: Boolean(next) })}
                />
              </div>

              {error ? <FieldError>{error}</FieldError> : null}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={save.isPending}
              >
                Abbrechen
              </Button>
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? "Speichern …" : existing ? "Speichern" : "Anlegen"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The one screen where the signing secret is readable. */
function SecretHandoff({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Webhook angelegt</DialogTitle>
        <DialogDescription>
          Trage das Secret jetzt beim Empfänger ein — es wird kein zweites Mal angezeigt.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-1">
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0">
            Wer das Secret verliert, legt einen neuen Webhook an — auslesen können wir es nicht.
          </p>
        </div>
        <CopyField
          label="Signatur-Secret"
          value={secret}
          description="Der Empfänger prüft damit den Header X-Wiki-Signature."
        />
      </div>

      <DialogFooter>
        <Button onClick={onDone}>Fertig</Button>
      </DialogFooter>
    </>
  );
}
