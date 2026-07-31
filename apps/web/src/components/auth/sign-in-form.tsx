import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@nilovon-wiki/ui/components/field";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

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
        <>
          Noch kein Konto?{" "}
          <Button variant="link" onClick={onSwitchToSignUp} className="h-auto p-0 font-semibold">
            Registrieren
          </Button>
        </>
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

      <PasskeySignIn />
    </AuthLayout>
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
    <div className="mt-6">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        oder
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="mt-4 w-full"
        disabled={pending}
        onClick={signIn}
      >
        <KeyRound className="size-4" />
        {pending ? "Warte auf Gerät …" : "Mit Passkey anmelden"}
      </Button>
    </div>
  );
}
