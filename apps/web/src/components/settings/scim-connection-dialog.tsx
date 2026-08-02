import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { SCIM_BASE_URL, useIdentityRefresh } from "@/lib/identity-queries";
import { toastError } from "@/lib/query";
import { CopyField } from "./copy-field";
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

const providerIdSchema = z
  .string()
  .min(2, "Mindestens 2 Zeichen")
  .max(48, "Höchstens 48 Zeichen")
  .regex(/^[a-z0-9-]+$/, "Nur Kleinbuchstaben, Ziffern und Bindestriche");

/** Ties the footer's submit button back to the form it sits outside of. */
const FORM_ID = "scim-connection-form";

/**
 * Creates a directory-sync connection, or rotates an existing one's token.
 *
 * Both are the same server call: generating a token for a provider id that
 * already exists replaces it, which invalidates the old one. That is why
 * rotating is presented as its own, explicitly warned action rather than as a
 * second "create".
 *
 * The token is shown exactly once. Only its hash is stored, so there is no
 * second chance — the same contract as the two-factor backup codes.
 */
export function SCIMConnectionDialog({
  open,
  onOpenChange,
  organizationId,
  /** Set to rotate an existing connection instead of creating one. */
  rotateProviderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  rotateProviderId?: string | null;
}) {
  const refresh = useIdentityRefresh();
  const [providerId, setProviderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProviderId(rotateProviderId ?? "");
    setError(null);
    setToken(null);
  }, [open, rotateProviderId]);

  const create = useMutation({
    mutationFn: async (value: string) => {
      const result = await authClient.scim.generateToken({ providerId: value, organizationId });
      if (result.error) {
        throw new Error(
          /collides/i.test(result.error.message ?? "")
            ? "Diese Anbieter-ID ist bereits durch eine Anmeldemethode belegt. Wähle eine andere."
            : (result.error.message ?? "Token konnte nicht erstellt werden"),
        );
      }
      return result.data as { scimToken: string };
    },
    onSuccess: async (data) => {
      await refresh();
      setToken(data.scimToken);
    },
    onError: toastError,
  });

  const submit = () => {
    const parsed = providerIdSchema.safeParse(providerId.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ungültige Anbieter-ID");
      return;
    }
    setError(null);
    create.mutate(parsed.data);
  };

  const isRotate = Boolean(rotateProviderId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing is the only way out of the token screen, so make sure the
        // value cannot linger in memory behind a reopened dialog.
        if (!next) setToken(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>Verbindung bereit</DialogTitle>
              <DialogDescription>
                Trage beides im Identitätsanbieter unter „Provisioning" ein.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
              <CopyField label="SCIM-Basis-URL" value={SCIM_BASE_URL} />
              <CopyField
                label="Bearer-Token"
                value={token}
                description="Wird als Authorization: Bearer … gesendet."
              />
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p>
                  Der Token wird <strong>nur jetzt</strong> angezeigt — gespeichert wird nur seine
                  Prüfsumme. Kopiere ihn, bevor du schließt; sonst musst du einen neuen erzeugen.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Token gesichert, schließen
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{isRotate ? "Token erneuern" : "Verbindung erstellen"}</DialogTitle>
              <DialogDescription>
                {isRotate
                  ? "Der bisherige Token wird dabei sofort ungültig. Die Synchronisierung steht still, bis der neue im Identitätsanbieter hinterlegt ist."
                  : "Erzeugt einen Bearer-Token, mit dem dein Identitätsanbieter Benutzer in diese Organisation anlegt, ändert und deaktiviert."}
              </DialogDescription>
            </DialogHeader>

            <form
              id={FORM_ID}
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="scim-provider-id">Anbieter-ID</FieldLabel>
                <Input
                  id="scim-provider-id"
                  autoFocus={!isRotate}
                  value={providerId}
                  onChange={(event) => {
                    setProviderId(event.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="okta-scim"
                  disabled={isRotate}
                  aria-invalid={error ? true : undefined}
                />
                {error ? (
                  <FieldError>{error}</FieldError>
                ) : (
                  <FieldDescription>
                    Kurzer interner Name der Verbindung. Muss sich von jeder Anbieter-ID unter
                    „Identitätsanbieter" unterscheiden.
                  </FieldDescription>
                )}
              </Field>
            </form>

            {/* Direct child of `DialogContent`: the footer's negative margins
                assume the dialog's padding box, not the form's. */}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                Abbrechen
              </Button>
              <Button type="submit" form={FORM_ID} disabled={create.isPending}>
                {create.isPending
                  ? "Wird erzeugt …"
                  : isRotate
                    ? "Token erneuern"
                    : "Verbindung erstellen"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
