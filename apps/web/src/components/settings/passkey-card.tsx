import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { toastError } from "@/lib/query";
import { SettingsCard, SettingsSection } from "./settings-section";
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
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * WebAuthn is only exposed on secure origins (HTTPS, or localhost). A plain-HTTP
 * LAN install — an explicitly supported deployment here — has no
 * `PublicKeyCredential` at all, so the section explains itself instead of
 * offering a button that throws on click.
 */
function passkeysSupported() {
  if (typeof window === "undefined") return false;
  return Boolean(window.PublicKeyCredential) && window.isSecureContext;
}

type Passkey = {
  id: string;
  name?: string | null;
  deviceType: string;
  createdAt?: string | Date | null;
};

export function PasskeyCard() {
  const { data, isPending } = authClient.useListPasskeys();
  const [addOpen, setAddOpen] = useState(false);
  const supported = passkeysSupported();

  const passkeys = (data ?? []) as Passkey[];

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) throw new Error(result.error.message ?? "Löschen fehlgeschlagen");
      return result.data;
    },
    onSuccess: () => toast.success("Passkey entfernt"),
    onError: toastError,
  });

  return (
    <SettingsSection
      title="Passkeys"
      description="Anmeldung per Fingerabdruck, Gesichtserkennung oder Sicherheitsschlüssel — ohne Passwort."
      action={
        supported ? (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <KeyRound className="size-4" /> Passkey hinzufügen
          </Button>
        ) : null
      }
    >
      <SettingsCard>
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            Passkeys brauchen eine sichere Verbindung. Rufe das Wiki über HTTPS (oder localhost)
            auf, um sie einzurichten.
          </p>
        ) : isPending ? (
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch kein Passkey hinterlegt.</p>
        ) : (
          <ul className="divide-y divide-border">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {passkey.name ?? "Unbenannter Passkey"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {passkey.deviceType === "singleDevice" ? "Dieses Gerät" : "Geräteübergreifend"}
                    {passkey.createdAt ? ` · seit ${formatDateTime(passkey.createdAt)}` : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Passkey entfernen"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(passkey.id)}
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">Passkey entfernen</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <AddPasskeyDialog open={addOpen} onOpenChange={setAddOpen} />
    </SettingsSection>
  );
}

function AddPasskeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      // The browser prompt runs inside this call; a user who dismisses it comes
      // back as an error, not a silent no-op.
      const result = await authClient.passkey.addPasskey({ name: name.trim() || undefined });
      if (result?.error) throw new Error(result.error.message ?? "Registrierung fehlgeschlagen");
      return result;
    },
    onSuccess: () => {
      toast.success("Passkey hinzugefügt");
      setName("");
      onOpenChange(false);
    },
    onError: toastError,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Passkey hinzufügen</DialogTitle>
          <DialogDescription>
            Dein Gerät fragt gleich nach Fingerabdruck, PIN oder Sicherheitsschlüssel.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="passkey-name">Name</FieldLabel>
            <Input
              id="passkey-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="MacBook"
            />
            <FieldDescription>
              Optional — hilft dir später, das richtige Gerät wiederzuerkennen.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={add.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Warte auf Gerät …" : "Passkey erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
