import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@nilovon-wiki/ui/components/field";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { useRegistrationPolicy } from "@/lib/registration-policy";

import AuthLayout from "../layouts/auth-layout";
import Loader from "../loader";

const formSchema = z.object({
  email: z.email("Ungültige E-Mail-Adresse"),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben"),
});

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const navigate = useNavigate({
    from: "/",
  });
  const { isPending } = authClient.useSession();
  const registration = useRegistrationPolicy();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      const { data, error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });

      if (error) {
        // Where the instance requires a confirmed address, correct credentials
        // still fail until the mail is opened. "E-Mail oder Passwort ist
        // falsch" would send the person hunting for a password problem that
        // does not exist. The other 403 here is a ban, whose message Better
        // Auth already localizes — so prefer the server's wording and only
        // supply our own for the verification case.
        if (error.code === "EMAIL_NOT_VERIFIED") {
          toast.error(
            "Diese E-Mail-Adresse ist noch nicht bestätigt. Öffne den Bestätigungslink, den wir dir geschickt haben.",
          );
          return;
        }
        if (error.status === 403 && error.message) {
          toast.error(error.message);
          return;
        }
        toast.error(
          error.status === 401
            ? "E-Mail oder Passwort ist falsch."
            : "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
        );
        return;
      }

      // With 2FA enabled the credentials alone create no session — better-auth
      // answers with a redirect marker and a short-lived two-factor cookie, and
      // the challenge route finishes the sign-in.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        navigate({ to: "/auth/two-factor" });
        return;
      }

      navigate({ to: "/" });
      toast.success("Erfolgreich angemeldet");
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  if (isPending) {
    return <Loader />;
  }

  return (
    <AuthLayout
      title="Willkommen zurück"
      subtitle="Melde dich in deinem Wissens-Hub an."
      footer={
        // A closed instance has no self-service registration, so offering the
        // link only leads somewhere that refuses. Invitation-only keeps it:
        // that is exactly the route an invited person takes.
        registration.mode === "closed" ? null : (
          <>
            Noch kein Konto?{" "}
            <Button variant="link" onClick={onSwitchToSignUp} className="h-auto p-0 font-semibold">
              Registrieren
            </Button>
          </>
        )
      }
    >
      <form
        id="sign-in-form"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <FieldGroup>
          <form.Field
            name="email"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>E-Mail</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="name@firma.de"
                    autoComplete="email"
                    type="email"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
          <form.Field
            name="password"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <div className="flex items-baseline justify-between">
                    <FieldLabel htmlFor={field.name}>Passwort</FieldLabel>
                    <Link
                      to="/auth/forgot-password"
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Passwort vergessen?
                    </Link>
                  </div>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    type="password"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
        </FieldGroup>

        <form.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button
              type="submit"
              size="lg"
              className="mt-1 w-full"
              disabled={!canSubmit || isSubmitting}
              form="sign-in-form"
            >
              {isSubmitting ? "Wird angemeldet …" : "Anmelden"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        oder
        <span className="h-px flex-1 bg-border" />
      </div>

      <form.Subscribe selector={(state) => state.values.email}>
        {(email) => <SSOSignIn email={email} />}
      </form.Subscribe>

      <PasskeySignIn />
    </AuthLayout>
  );
}

/**
 * The two failures a person can actually hit here, told apart.
 *
 * `401` is the one worth spelling out: it means an administrator connected the
 * provider but has not finished the DNS domain check yet, so sign-in is refused
 * on purpose. Reported as a generic failure it looks like a broken password.
 */
function ssoErrorMessage(status: number | undefined, domain: string | undefined): string {
  const forDomain = domain ? `die Domain ${domain}` : "diese Adresse";
  if (status === 404) return `Für ${forDomain} ist kein Single Sign-On eingerichtet.`;
  if (status === 401) {
    return `Single Sign-On für ${forDomain} ist noch nicht freigeschaltet — die Domain wurde noch nicht bestätigt. Wende dich an eure IT.`;
  }
  return "Anmeldung über Single Sign-On fehlgeschlagen.";
}

/**
 * Sign in through the organization's identity provider.
 *
 * The provider is resolved from the address' domain, so this reuses the e-mail
 * already typed above rather than asking for it a second time — but it does not
 * *require* a valid-looking address up front: an empty field gets a nudge to the
 * field, and an unknown domain gets told exactly that instead of a generic
 * failure, because "my company uses SSO but this says login failed" is the worst
 * possible dead end here.
 */
function SSOSignIn({ email }: { email: string }) {
  const [pending, setPending] = useState(false);

  const signIn = async () => {
    const address = email.trim();
    if (!address) {
      toast.error("Bitte zuerst die E-Mail-Adresse eintragen.");
      document.getElementById("email")?.focus();
      return;
    }

    setPending(true);
    // On success the browser is redirected to the identity provider, so this
    // promise only ever resolves on failure — no success branch to write.
    const result = await authClient.signIn.sso({
      email: address,
      callbackURL: `${window.location.origin}/`,
      errorCallbackURL: `${window.location.origin}/auth/login`,
    });
    setPending(false);

    if (result?.error) {
      const domain = address.split("@")[1];
      toast.error(ssoErrorMessage(result.error.status, domain));
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="mt-4 w-full"
      disabled={pending}
      onClick={signIn}
    >
      <Building2 className="size-4" />
      {pending ? "Weiterleitung …" : "Mit Firmenkonto anmelden"}
    </Button>
  );
}

/**
 * WebAuthn exists only on secure origins (HTTPS, or localhost), and a user who
 * never registered a passkey has nothing to pick — so the button appears only
 * where it can actually work, and a cancelled prompt stays silent.
 */
function PasskeySignIn() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  const supported =
    typeof window !== "undefined" && Boolean(window.PublicKeyCredential) && window.isSecureContext;
  if (!supported) return null;

  const signIn = async () => {
    setPending(true);
    const result = await authClient.signIn.passkey();
    setPending(false);

    if (result?.error) {
      toast.error("Anmeldung mit Passkey fehlgeschlagen.");
      return;
    }
    navigate({ to: "/" });
    toast.success("Erfolgreich angemeldet");
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="mt-3 w-full"
      disabled={pending}
      onClick={signIn}
    >
      <KeyRound className="size-4" />
      {pending ? "Warte auf Gerät …" : "Mit Passkey anmelden"}
    </Button>
  );
}
