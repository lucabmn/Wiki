import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import AuthLayout from "@/components/layouts/auth-layout";
import { authClient } from "@/lib/auth-client";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";

export const Route = createFileRoute("/auth/two-factor")({
  component: TwoFactorChallenge,
});

/**
 * Second step of sign-in for accounts with 2FA.
 *
 * `signIn.email` answers `{ twoFactorRedirect: true }` and issues only a short
 * lived two-factor cookie — no session — so the user lands here and the real
 * session is created by `verifyTotp` / `verifyBackupCode`. Without this route,
 * turning 2FA on in the settings would lock the account out.
 */
function TwoFactorChallenge() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const value = code.trim();
    if (!value) return;
    setPending(true);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: value })
      : await authClient.twoFactor.verifyTotp({ code: value });
    setPending(false);

    if (error) {
      toast.error(
        useBackup ? "Backup-Code ungültig oder bereits benutzt." : "Code ungültig oder abgelaufen.",
      );
      return;
    }

    toast.success("Erfolgreich angemeldet");
    navigate({ to: "/" });
  };

  return (
    <AuthLayout
      title="Bestätigung nötig"
      subtitle={
        useBackup
          ? "Gib einen deiner Backup-Codes ein."
          : "Gib den Code aus deiner Authenticator-App ein."
      }
      footer={
        <Button
          variant="link"
          className="h-auto p-0 font-semibold"
          onClick={() => {
            setUseBackup((previous) => !previous);
            setCode("");
          }}
        >
          {useBackup ? "Doch die Authenticator-App benutzen" : "Kein Zugriff? Backup-Code benutzen"}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field>
          <FieldLabel htmlFor="two-factor-code">
            {useBackup ? "Backup-Code" : "Einmalcode"}
          </FieldLabel>
          <Input
            id="two-factor-code"
            autoFocus
            autoComplete={useBackup ? "off" : "one-time-code"}
            inputMode={useBackup ? "text" : "numeric"}
            placeholder={useBackup ? "XXXXXXXXXX" : "123456"}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <FieldDescription>
            {useBackup
              ? "Jeder Backup-Code lässt sich nur einmal verwenden."
              : "Der Code wechselt alle 30 Sekunden."}
          </FieldDescription>
        </Field>

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending || !code.trim()}>
          {pending ? "Wird geprüft …" : "Anmelden"}
        </Button>
      </form>
    </AuthLayout>
  );
}
