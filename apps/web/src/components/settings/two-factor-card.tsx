import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { SettingsCard, SettingsSection } from "./settings-section";
import { Badge } from "@nilovon-wiki/ui/components/badge";
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

/** The shared secret, for authenticator apps that cannot scan a code. */
function secretFromUri(totpURI: string): string | null {
  try {
    return new URL(totpURI).searchParams.get("secret");
  } catch {
    return null;
  }
}

async function copy(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Kopieren fehlgeschlagen");
  }
}

/**
 * TOTP two-factor authentication.
 *
 * Enabling is deliberately two-staged: `/two-factor/enable` only *provisions* the
 * secret, and the account is not actually protected until `verifyTotp` confirms
 * the user's authenticator produces matching codes. Showing the backup codes in
 * between is the only chance to save them — the server stores them hashed.
 */
export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);

  return (
    <SettingsSection
      title="Zwei-Faktor-Authentifizierung"
      description="Zusätzlich zum Passwort ein Einmalcode aus deiner Authenticator-App."
    >
      <SettingsCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {enabled ? (
              <Badge variant="secondary">
                <ShieldCheck className="size-3" /> Aktiv
              </Badge>
            ) : (
              <Badge variant="outline">
                <ShieldOff className="size-3" /> Inaktiv
              </Badge>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              {enabled
                ? "Bei der Anmeldung fragen wir nach einem Code aus deiner App."
                : "Empfohlen, wenn dein Wiki über das Internet erreichbar ist."}
            </p>
          </div>
          <div className="flex gap-2">
            {enabled ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setCodesOpen(true)}>
                  Backup-Codes neu erzeugen
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDisableOpen(true)}>
                  Deaktivieren
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEnableOpen(true)}>
                Aktivieren
              </Button>
            )}
          </div>
        </div>
      </SettingsCard>

      <EnableDialog open={enableOpen} onOpenChange={setEnableOpen} />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
      <RegenerateCodesDialog open={codesOpen} onOpenChange={setCodesOpen} />
    </SettingsSection>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => copy(codes.join("\n"), "Backup-Codes kopiert")}
      >
        <Copy className="size-4" /> Codes kopieren
      </Button>
    </div>
  );
}

function EnableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [provisioned, setProvisioned] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);

  const reset = () => {
    setPassword("");
    setCode("");
    setProvisioned(null);
  };

  const start = useMutation({
    mutationFn: async () => {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) throw new Error(result.error.message ?? "Aktivierung fehlgeschlagen");
      return result.data;
    },
    onSuccess: (data) => {
      setProvisioned({ totpURI: data.totpURI, backupCodes: data.backupCodes });
      setPassword("");
    },
    onError: toastError,
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (result.error) throw new Error(result.error.message ?? "Code ungültig");
      return result.data;
    },
    onSuccess: () => {
      toast.success("Zwei-Faktor-Authentifizierung aktiv");
      reset();
      onOpenChange(false);
    },
    onError: toastError,
  });

  const secret = provisioned ? secretFromUri(provisioned.totpURI) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zwei-Faktor-Authentifizierung aktivieren</DialogTitle>
          <DialogDescription>
            {provisioned
              ? "Scanne den Code mit deiner Authenticator-App und bestätige mit dem angezeigten Einmalcode."
              : "Bestätige zuerst dein Passwort."}
          </DialogDescription>
        </DialogHeader>

        {provisioned ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              confirm.mutate();
            }}
          >
            <div className="flex justify-center rounded-md bg-white p-4">
              <QRCodeSVG value={provisioned.totpURI} size={168} />
            </div>

            {secret ? (
              <Field>
                <FieldLabel htmlFor="totp-secret">Schlüssel zum Abtippen</FieldLabel>
                <div className="flex gap-2">
                  <Input id="totp-secret" readOnly value={secret} className="font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Schlüssel kopieren"
                    onClick={() => copy(secret, "Schlüssel kopiert")}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </Field>
            ) : null}

            <Field>
              <FieldLabel>Backup-Codes</FieldLabel>
              <BackupCodes codes={provisioned.backupCodes} />
              <FieldDescription>
                Jeder Code funktioniert einmal, falls du keinen Zugriff auf deine App hast. Sie
                werden nur jetzt angezeigt.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="totp-code">Code aus der App</FieldLabel>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={confirm.isPending}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={confirm.isPending || code.trim().length < 6}>
                {confirm.isPending ? "Prüfen …" : "Aktivieren"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              start.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="totp-password">Passwort</FieldLabel>
              <Input
                id="totp-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={start.isPending}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={start.isPending || !password}>
                {start.isPending ? "Weiter …" : "Weiter"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");

  const disable = useMutation({
    mutationFn: async () => {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) throw new Error(result.error.message ?? "Deaktivieren fehlgeschlagen");
      return result.data;
    },
    onSuccess: () => {
      toast.success("Zwei-Faktor-Authentifizierung deaktiviert");
      setPassword("");
      onOpenChange(false);
    },
    onError: toastError,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPassword("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zwei-Faktor-Authentifizierung deaktivieren</DialogTitle>
          <DialogDescription>
            Dein Konto ist danach nur noch durch das Passwort geschützt.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            disable.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="totp-disable-password">Passwort</FieldLabel>
            <Input
              id="totp-disable-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={disable.isPending}
            >
              Abbrechen
            </Button>
            <Button type="submit" variant="destructive" disabled={disable.isPending || !password}>
              {disable.isPending ? "Deaktivieren …" : "Deaktivieren"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegenerateCodesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  const regenerate = useMutation({
    mutationFn: async () => {
      const result = await authClient.twoFactor.generateBackupCodes({ password });
      if (result.error) throw new Error(result.error.message ?? "Erzeugen fehlgeschlagen");
      return result.data;
    },
    onSuccess: (data) => {
      setCodes(data.backupCodes);
      setPassword("");
    },
    onError: toastError,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPassword("");
          setCodes(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backup-Codes neu erzeugen</DialogTitle>
          <DialogDescription>
            Die bisherigen Codes verlieren dabei ihre Gültigkeit.
          </DialogDescription>
        </DialogHeader>

        {codes ? (
          <div className="space-y-4">
            <BackupCodes codes={codes} />
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Fertig
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              regenerate.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="totp-codes-password">Passwort</FieldLabel>
              <Input
                id="totp-codes-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={regenerate.isPending}
              >
                Abbrechen
              </Button>
              <Button type="submit" disabled={regenerate.isPending || !password}>
                {regenerate.isPending ? "Erzeugen …" : "Neu erzeugen"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
