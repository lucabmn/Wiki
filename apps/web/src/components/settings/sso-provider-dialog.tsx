import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { ssoRedirectURI, useIdentityRefresh, type SSOProvider } from "@/lib/identity-queries";
import { toastError } from "@/lib/query";
import { CopyField } from "./copy-field";
import type { DomainVerificationTarget } from "./sso-domain-dialog";
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

/**
 * Identifies the provider in URLs — the callback path and the `account` rows of
 * everyone who signs in through it — so it is restricted to the same URL-safe
 * shape as an organization slug, and immutable once created.
 */
const providerIdSchema = z
  .string()
  .min(2, "Mindestens 2 Zeichen")
  .max(48, "Höchstens 48 Zeichen")
  .regex(/^[a-z0-9-]+$/, "Nur Kleinbuchstaben, Ziffern und Bindestriche");

/**
 * Bare e-mail domains, comma-separated — `acme.com` or `acme.com,acme.de`, never
 * a URL. This is what an address typed on the sign-in screen is matched against.
 */
const domainSchema = z
  .string()
  .min(1, "Mindestens eine Domain")
  .refine(
    (value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .every((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry)),
    "Nur E-Mail-Domains wie acme.com, mehrere durch Komma getrennt",
  );

const issuerSchema = z.url("Vollständige URL, z. B. https://acme.okta.com");

/** Ties the pinned footer's submit button back to the scrollable form. */
const FORM_ID = "sso-provider-form";

type FormState = {
  providerId: string;
  domain: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  providerId: "",
  domain: "",
  issuer: "",
  clientId: "",
  clientSecret: "",
};

/**
 * Better Auth reports these in English and at a level of detail that only makes
 * sense if you know the plugin. Translate the ones an operator can actually act
 * on; anything else falls through to the server's own message.
 */
function friendlyRegistrationError(message: string): string {
  if (/identity fields while linked accounts exist/i.test(message)) {
    return "Issuer und Client-ID lassen sich nicht mehr ändern, sobald sich jemand über diesen Anbieter angemeldet hat. Entferne den Anbieter, wenn du ihn wirklich neu verbinden willst.";
  }
  if (/already exists/i.test(message)) {
    return "Diese Anbieter-ID ist bereits vergeben.";
  }
  if (/reserved/i.test(message)) {
    return "Diese Anbieter-ID ist reserviert. Wähle eine andere.";
  }
  if (/discovery/i.test(message)) {
    return "Unter der Issuer-URL wurde keine gültige OpenID-Konfiguration gefunden. Prüfe die URL — sie muss ohne /.well-known/… angegeben werden.";
  }
  return message;
}

/**
 * Connect or edit an OIDC identity provider.
 *
 * SAML is supported by the server but not exposed here: OIDC covers Entra ID,
 * Okta, Keycloak, Authentik and Google Workspace with five fields, whereas SAML
 * needs certificates and assertion mappings that do not belong in a dialog.
 *
 * On edit the client secret is left blank and only sent when the operator types
 * a new one — the server never hands the stored one back, and an empty field
 * must mean "unchanged", not "erase".
 */
export function SSOProviderDialog({
  open,
  onOpenChange,
  organizationId,
  existing,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  existing: SSOProvider | null;
  /**
   * Called after a *new* provider is registered. A provider is inert until its
   * domain is verified, so the caller hands straight over to that step instead
   * of leaving the operator to find it.
   */
  onCreated: (target: DomainVerificationTarget) => void;
}) {
  const refresh = useIdentityRefresh();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      existing
        ? {
            providerId: existing.providerId,
            domain: existing.domain,
            issuer: existing.issuer,
            clientId: "",
            clientSecret: "",
          }
        : EMPTY,
    );
  }, [open, existing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const save = useMutation({
    mutationFn: async (value: FormState) => {
      const oidcConfig = {
        ...(value.clientId.trim() ? { clientId: value.clientId.trim() } : {}),
        ...(value.clientSecret.trim() ? { clientSecret: value.clientSecret.trim() } : {}),
      };

      const result = existing
        ? await authClient.sso.updateProvider({
            providerId: existing.providerId,
            issuer: value.issuer.trim(),
            domain: value.domain.trim(),
            ...(Object.keys(oidcConfig).length > 0 ? { oidcConfig } : {}),
          })
        : await authClient.sso.register({
            providerId: value.providerId.trim(),
            issuer: value.issuer.trim(),
            domain: value.domain.trim(),
            organizationId,
            oidcConfig: {
              clientId: value.clientId.trim(),
              clientSecret: value.clientSecret.trim(),
            },
          });

      if (result.error) {
        throw new Error(
          friendlyRegistrationError(result.error.message ?? "Speichern fehlgeschlagen"),
        );
      }
      return result.data;
    },
    onSuccess: async (_data, value) => {
      await refresh();
      onOpenChange(false);

      if (existing) {
        toast.success("Anbieter gespeichert");
        return;
      }
      toast.success("Anbieter verbunden — jetzt noch die Domain bestätigen");
      onCreated({ providerId: value.providerId.trim(), domain: value.domain.trim() });
    },
    onError: toastError,
  });

  const submit = () => {
    const next: FormErrors = {};

    if (!existing) {
      const parsed = providerIdSchema.safeParse(form.providerId.trim());
      if (!parsed.success) next.providerId = parsed.error.issues[0]?.message;
    }

    const domain = domainSchema.safeParse(form.domain.trim());
    if (!domain.success) next.domain = domain.error.issues[0]?.message;

    const issuer = issuerSchema.safeParse(form.issuer.trim());
    if (!issuer.success) next.issuer = issuer.error.issues[0]?.message;

    if (!existing) {
      if (!form.clientId.trim()) next.clientId = "Erforderlich";
      if (!form.clientSecret.trim()) next.clientSecret = "Erforderlich";
    }

    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(form);
  };

  const providerId = existing?.providerId ?? form.providerId.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the default: this form carries absolute URLs — the redirect
          URI and the issuer — that have to be readable in one line to be checked
          against what the identity provider shows. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Anbieter bearbeiten" : "Anbieter verbinden"}</DialogTitle>
          <DialogDescription>
            Lege im Identitätsanbieter eine OIDC-Anwendung („Web application") an und trage die
            Zugangsdaten hier ein. Die Weiterleitungs-URL unten braucht der Anbieter dafür.
          </DialogDescription>
        </DialogHeader>

        {/* Only the fields scroll. `DialogFooter` cancels the dialog's own
            padding with negative margins to sit flush against its edges, so it
            has to stay a direct child of `DialogContent` — inside this box it
            would both scroll away and overflow sideways. The submit button
            reaches back in via `form=`. */}
        <form
          id={FORM_ID}
          className="max-h-[60vh] space-y-4 overflow-y-auto px-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field data-invalid={errors.providerId ? true : undefined}>
            <FieldLabel htmlFor="sso-provider-id">Anbieter-ID</FieldLabel>
            <Input
              id="sso-provider-id"
              autoFocus={!existing}
              value={form.providerId}
              onChange={(event) => set("providerId", event.target.value)}
              placeholder="okta"
              disabled={Boolean(existing)}
              aria-invalid={errors.providerId ? true : undefined}
            />
            {errors.providerId ? (
              <FieldError>{errors.providerId}</FieldError>
            ) : (
              <FieldDescription>
                {existing
                  ? "Nicht änderbar — sie steckt in der Weiterleitungs-URL und in bestehenden Anmeldungen."
                  : "Kurzer interner Name. Steckt in der Weiterleitungs-URL und ist später nicht mehr änderbar."}
              </FieldDescription>
            )}
          </Field>

          <CopyField
            label="Weiterleitungs-URL (Redirect URI)"
            value={ssoRedirectURI(providerId || "<anbieter-id>")}
            description="Im Identitätsanbieter als einzige erlaubte Redirect-URI hinterlegen."
          />

          <Field data-invalid={errors.domain ? true : undefined}>
            <FieldLabel htmlFor="sso-domain">E-Mail-Domain</FieldLabel>
            <Input
              id="sso-domain"
              value={form.domain}
              onChange={(event) => set("domain", event.target.value)}
              placeholder="acme.com"
              aria-invalid={errors.domain ? true : undefined}
            />
            {errors.domain ? (
              <FieldError>{errors.domain}</FieldError>
            ) : (
              <FieldDescription>
                Wer sich mit einer Adresse dieser Domain anmeldet, wird hierher geschickt. Mehrere
                Domains durch Komma trennen.
              </FieldDescription>
            )}
          </Field>

          <Field data-invalid={errors.issuer ? true : undefined}>
            <FieldLabel htmlFor="sso-issuer">Issuer-URL</FieldLabel>
            <Input
              id="sso-issuer"
              type="url"
              value={form.issuer}
              onChange={(event) => set("issuer", event.target.value)}
              placeholder="https://acme.okta.com"
              aria-invalid={errors.issuer ? true : undefined}
            />
            {errors.issuer ? (
              <FieldError>{errors.issuer}</FieldError>
            ) : (
              <FieldDescription>
                Ohne <code>/.well-known/openid-configuration</code> — die Endpunkte werden beim
                Speichern selbst ermittelt.
              </FieldDescription>
            )}
          </Field>

          <Field data-invalid={errors.clientId ? true : undefined}>
            <FieldLabel htmlFor="sso-client-id">Client-ID</FieldLabel>
            <Input
              id="sso-client-id"
              value={form.clientId}
              onChange={(event) => set("clientId", event.target.value)}
              placeholder={existing ? `unverändert (${existing.oidcConfig?.clientIdLastFour})` : ""}
              autoComplete="off"
              aria-invalid={errors.clientId ? true : undefined}
            />
            {errors.clientId ? (
              <FieldError>{errors.clientId}</FieldError>
            ) : existing ? (
              <FieldDescription>Leer lassen, um die bisherige zu behalten.</FieldDescription>
            ) : null}
          </Field>

          <Field data-invalid={errors.clientSecret ? true : undefined}>
            <FieldLabel htmlFor="sso-client-secret">Client-Secret</FieldLabel>
            <Input
              id="sso-client-secret"
              type="password"
              value={form.clientSecret}
              onChange={(event) => set("clientSecret", event.target.value)}
              placeholder={existing ? "unverändert" : ""}
              autoComplete="new-password"
              aria-invalid={errors.clientSecret ? true : undefined}
            />
            {errors.clientSecret ? (
              <FieldError>{errors.clientSecret}</FieldError>
            ) : (
              <FieldDescription>
                {existing
                  ? "Leer lassen, um das bisherige zu behalten — zum Rotieren das neue eintragen."
                  : "Wird serverseitig gespeichert und nie wieder angezeigt."}
              </FieldDescription>
            )}
          </Field>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Abbrechen
          </Button>
          <Button type="submit" form={FORM_ID} disabled={save.isPending}>
            {save.isPending ? "Wird geprüft …" : existing ? "Speichern" : "Verbinden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
