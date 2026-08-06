import { Button } from "@nilovon-wiki/ui/components/button";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@nilovon-wiki/ui/components/field";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { useRegistrationPolicy } from "@/lib/registration-policy";

import AuthLayout from "../layouts/auth-layout";
import Loader from "../loader";

const formSchema = z.object({
  name: z.string().min(2, "Name muss mindestens 2 Zeichen haben"),
  email: z.email("Ungültige E-Mail-Adresse"),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben"),
});

export default function SignUpForm({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const navigate = useNavigate({
    from: "/",
  });
  const { isPending } = authClient.useSession();
  const policy = useRegistrationPolicy();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
        },
        {
          onSuccess: () => {
            // With verification required there is no session yet — sending the
            // person to the app would only bounce them back to a login they
            // cannot pass until they open the mail.
            if (policy.emailVerificationRequired) {
              toast.success(
                `Wir haben eine Bestätigungs-E-Mail an ${value.email} geschickt. Bestätige die Adresse, um dich anzumelden.`,
              );
              onSwitchToSignIn();
              return;
            }
            navigate({
              to: "/",
            });
            toast.success("Erfolgreich registriert");
          },
          onError: (error) => {
            // 403 is the instance's registration policy talking (closed,
            // invitation required, domain not allowed). Its message names the
            // actual reason, and replacing it with "please try again" would
            // send someone round a loop that cannot succeed.
            if (error.error.status === 403 && error.error.message) {
              toast.error(error.error.message);
              return;
            }
            toast.error(
              error.error.status === 422
                ? "Ein Konto mit dieser E-Mail existiert bereits."
                : "Registrierung fehlgeschlagen. Bitte versuche es erneut.",
            );
          },
        },
      );
    },
    validators: {
      onSubmit: formSchema,
    },
  });

  if (isPending || policy.isPending) {
    return <Loader />;
  }

  // Enforcement lives on the server; this only avoids presenting a form that
  // can only ever be refused.
  if (policy.mode === "closed") {
    return (
      <AuthLayout
        title="Registrierung deaktiviert"
        subtitle="Auf dieser Instanz werden Konten von der Administration angelegt."
        footer={
          <>
            Bereits ein Konto?{" "}
            <Button variant="link" onClick={onSwitchToSignIn} className="h-auto p-0 font-semibold">
              Anmelden
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">
          Wende dich an die Administration deiner Instanz, um einen Zugang zu erhalten. Wenn dein
          Unternehmen Single Sign-On nutzt, melde dich stattdessen über euren Anbieter an.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Konto erstellen"
      subtitle={
        policy.mode === "invite"
          ? "Diese Instanz ist auf eingeladene Personen beschränkt."
          : "Leg los mit deinem Wissens-Hub."
      }
      footer={
        <>
          Bereits ein Konto?{" "}
          <Button variant="link" onClick={onSwitchToSignIn} className="h-auto p-0 font-semibold">
            Anmelden
          </Button>
        </>
      }
    >
      <form
        id="sign-up-form"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        {policy.mode === "invite" && (
          <p className="text-muted-foreground rounded-md border p-3 text-sm">
            Registriere dich mit genau der E-Mail-Adresse, an die deine Einladung geschickt wurde —
            andere Adressen werden abgelehnt.
          </p>
        )}
        <FieldGroup>
          <form.Field
            name="name"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="Name"
                    autoComplete="name"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />
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
                  <FieldLabel htmlFor={field.name}>Passwort</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="••••••••"
                    autoComplete="new-password"
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
              form="sign-up-form"
            >
              {isSubmitting ? "Wird erstellt …" : "Registrieren"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthLayout>
  );
}
