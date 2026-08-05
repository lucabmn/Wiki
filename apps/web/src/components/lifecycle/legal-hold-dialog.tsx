import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";

/**
 * Setting and lifting a deletion block. One dialog for both directions, because
 * they are the same conversation from opposite ends and both need the same thing
 * from the user: a reason.
 *
 * The reason is mandatory, not politeness. A block without one becomes
 * un-releasable in practice — months later nobody can say whether it still
 * applies, so it is left in place forever and quietly breaks the trash.
 */
export function LegalHoldDialog({
  open,
  onOpenChange,
  subject,
  subjectId,
  subjectLabel,
  activeHold,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: "page" | "space" | "organization";
  subjectId?: string;
  /** What the user is looking at, so the dialog can name it. */
  subjectLabel: string;
  /** Set when a block already exists here — the dialog then offers the release. */
  activeHold: { id: string; reason: string | null } | null;
}) {
  const invalidateHolds = useInvalidate(orpc.legalHolds.key());
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open, activeHold?.id]);

  const done = (message: string) => {
    invalidateHolds();
    onOpenChange(false);
    toast.success(message);
  };

  const create = useMutation(
    orpc.legalHolds.create.mutationOptions({
      onSuccess: () => done("Löschsperre gesetzt"),
      onError: toastError,
    }),
  );
  const release = useMutation(
    orpc.legalHolds.release.mutationOptions({
      onSuccess: () => done("Löschsperre aufgehoben"),
      onError: toastError,
    }),
  );

  const releasing = activeHold !== null;
  const pending = create.isPending || release.isPending;
  const trimmed = reason.trim();
  const valid = trimmed.length >= 3;

  const submit = () => {
    if (!valid || pending) return;
    if (activeHold) release.mutate({ id: activeHold.id, reason: trimmed });
    else create.mutate({ subject, subjectId, reason: trimmed });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {releasing ? (
              <ShieldOff className="size-4 text-amber-600" />
            ) : (
              <ShieldCheck className="size-4 text-primary" />
            )}
            {releasing ? "Löschsperre aufheben" : "Löschsperre setzen"}
          </DialogTitle>
          <DialogDescription>
            {releasing
              ? `„${subjectLabel}“ kann danach wieder gelöscht werden und unterliegt erneut den Aufbewahrungsfristen.`
              : `„${subjectLabel}“ kann dann von niemandem gelöscht werden — weder manuell noch durch den Ablauf einer Frist.`}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {activeHold?.reason ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="text-xs font-medium text-muted-foreground">Bestehende Begründung</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{activeHold.reason}</p>
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="hold-reason">
              {releasing ? "Begründung der Aufhebung" : "Begründung"}
            </FieldLabel>
            <Textarea
              id="hold-reason"
              rows={3}
              maxLength={2000}
              autoFocus
              disabled={pending}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                releasing
                  ? "z. B. Verfahren abgeschlossen, Freigabe durch Rechtsabteilung"
                  : "z. B. Rechtsstreit Müller vs. Acme, Az. 4 O 123/26"
              }
            />
            <FieldDescription>
              {releasing
                ? "Die Aufhebung wird als eigenes Ereignis protokolliert — dauerhaft und unabhängig von den Aufbewahrungsfristen."
                : "Wird im Aktivitätsprotokoll festgehalten und bleibt dort dauerhaft erhalten."}
            </FieldDescription>
          </Field>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
              Abbrechen
            </DialogClose>
            <Button
              type="submit"
              variant={releasing ? "destructive" : "default"}
              disabled={!valid || pending}
            >
              {pending ? "Speichern …" : releasing ? "Sperre aufheben" : "Sperre setzen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
