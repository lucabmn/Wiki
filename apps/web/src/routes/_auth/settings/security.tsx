import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { PasskeyCard } from "@/components/settings/passkey-card";
import { SessionCard } from "@/components/settings/session-card";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";

export const Route = createFileRoute("/_auth/settings/security")({
  component: SecuritySettings,
});

function SecuritySettings() {
  const { data: session } = authClient.useSession();

  return (
    <div className="space-y-8">
      <PasswordForm />
      <TwoFactorCard enabled={session?.user.twoFactorEnabled ?? false} />
      <PasskeyCard />
      <SessionCard />
    </div>
  );
}

const MIN_PASSWORD_LENGTH = 8;

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: async () => {
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        // A password change is the standard response to "someone else may be in
        // my account" — leaving their sessions alive would defeat it.
        revokeOtherSessions: true,
      });
      if (result.error) throw new Error(result.error.message ?? "Änderung fehlgeschlagen");
      return result.data;
    },
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setRepeat("");
      toast.success("Passwort geändert — andere Geräte wurden abgemeldet");
    },
    onError: toastError,
  });

  const submit = () => {
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`);
      return;
    }
    if (next !== repeat) {
      setError("Die Passwörter stimmen nicht überein");
      return;
    }
    setError(null);
    change.mutate();
  };

  return (
    <SettingsSection
      title="Passwort"
      description="Beim Ändern werden alle anderen angemeldeten Geräte abgemeldet."
    >
      <SettingsCard>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field>
            <FieldLabel htmlFor="password-current">Aktuelles Passwort</FieldLabel>
            <Input
              id="password-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>

          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="password-new">Neues Passwort</FieldLabel>
            <Input
              id="password-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => {
                setNext(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
            />
            <FieldDescription>Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</FieldDescription>
          </Field>

          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="password-repeat">Neues Passwort wiederholen</FieldLabel>
            <Input
              id="password-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => {
                setRepeat(event.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={change.isPending || !current || !next || !repeat}
            >
              {change.isPending ? "Ändern …" : "Passwort ändern"}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}
