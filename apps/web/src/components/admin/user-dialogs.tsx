import { useState, type ComponentType, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldBan } from "lucide-react";
import { toast } from "sonner";

import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";

type IconComponent = ComponentType<{ className?: string }>;

/**
 * One confirmation shape for every admin action, so "are you sure?" always
 * looks and behaves the same.
 *
 * Unavailable actions keep their button and gain a `title` explaining why —
 * a greyed-out control with no reason reads as a bug, and a button that simply
 * disappears reads as a missing feature.
 */
export function ConfirmDialog({
  label,
  icon: Icon,
  title,
  description,
  confirmLabel,
  destructive = false,
  disabled = false,
  disabledReason,
  confirmDisabled = false,
  isPending = false,
  children,
  onConfirm,
  onClose,
}: {
  label: string;
  icon: IconComponent;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Extra gate on the confirm button, e.g. a typed-out email address. */
  confirmDisabled?: boolean;
  isPending?: boolean;
  /** Optional fields rendered between the description and the footer. */
  children?: ReactNode;
  onConfirm: () => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) onClose?.();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen(true)}
      >
        <Icon className="size-4" aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => change(false)}>
              Abbrechen
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={confirmDisabled || isPending}
              onClick={() => {
                onConfirm();
                change(false);
              }}
            >
              {isPending ? "Wird ausgeführt …" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const DURATIONS = [
  { value: "permanent", label: "Unbefristet", days: undefined },
  { value: "1", label: "1 Tag", days: 1 },
  { value: "7", label: "7 Tage", days: 7 },
  { value: "30", label: "30 Tage", days: 30 },
  { value: "90", label: "90 Tage", days: 90 },
] as const;

/**
 * Banning takes a reason and a duration. Both land in the audit log, and the
 * reason is what the person reviewing the block months later has to go on — a
 * ban with no stated reason is what support cases are made of.
 */
export function BanDialog({
  userId,
  userName,
  disabled,
  onDone,
}: {
  userId: string;
  userName: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<string>("permanent");

  const ban = useMutation(
    orpc.admin.users.ban.mutationOptions({
      onSuccess: () => {
        toast.success(`${userName} wurde gesperrt und überall abgemeldet`);
        setOpen(false);
        setReason("");
        setDuration("permanent");
        onDone();
      },
      onError: toastError,
    }),
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        title={disabled ? "Das eigene Konto lässt sich hier nicht sperren." : undefined}
        onClick={() => setOpen(true)}
      >
        <ShieldBan className="size-4" aria-hidden />
        Sperren
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{userName} sperren?</DialogTitle>
            <DialogDescription>
              Die Anmeldung wird blockiert und alle laufenden Sitzungen enden sofort — auch bereits
              geöffnete Browser-Tabs.
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="ban-reason">Grund</FieldLabel>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="z. B. Konto kompromittiert, auf Anfrage der Personalabteilung …"
              rows={3}
            />
            <FieldDescription>
              Steht im Protokoll und hilft der Person, die die Sperre später prüft.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="ban-duration">Dauer</FieldLabel>
            <NativeSelect
              id="ban-duration"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            >
              {DURATIONS.map((entry) => (
                <NativeSelectOption key={entry.value} value={entry.value}>
                  {entry.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length === 0 || ban.isPending}
              onClick={() =>
                ban.mutate({
                  userId,
                  reason: reason.trim(),
                  expiresInDays: DURATIONS.find((entry) => entry.value === duration)?.days,
                })
              }
            >
              {ban.isPending ? "Wird gesperrt …" : "Sperren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
