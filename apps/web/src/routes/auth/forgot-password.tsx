import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";

import AuthLayout from "@/components/layouts/auth-layout";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/auth/forgot-password")({
  component: RouteComponent,
});

const formSchema = z.object({ email: z.email("Ungültige E-Mail-Adresse") });

function RouteComponent() {
  const [sent, setSent] = useState(false);

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      await authClient.requestPasswordReset({
        email: value.email,
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      // Always report success: telling the visitor whether an address exists
      // would turn this form into an account-enumeration oracle.
      setSent(true);
    },
  });

  return (
    <AuthLayout
      title="Passwort vergessen"
      subtitle="Wir schicken dir einen Link zum Zurücksetzen."
      footer={
        <>
          Passwort wieder eingefallen?{" "}
          <Link to="/auth/login" className="font-semibold underline-offset-4 hover:underline">
            Zur Anmeldung
          </Link>
        </>
      }
    >
      {sent ? (
        <p className="text-sm text-muted-foreground">
          Falls ein Konto mit dieser Adresse existiert, ist eine E-Mail mit einem Link zum
          Zurücksetzen unterwegs. Der Link ist eine Stunde gültig.
        </p>
      ) : (
        <form
          id="forgot-password-form"
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
                form="forgot-password-form"
              >
                {isSubmitting ? "Wird gesendet …" : "Link anfordern"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      )}
    </AuthLayout>
  );
}
