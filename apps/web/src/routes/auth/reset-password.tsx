import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import AuthLayout from "@/components/layouts/auth-layout";
import { authClient } from "@/lib/auth-client";

// Better Auth's callback appends `?token=…` on success and `?error=…` when the
// token is missing, already used, or expired.
const searchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/auth/reset-password")({
  validateSearch: searchSchema,
  component: RouteComponent,
});

const formSchema = z
  .object({
    password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben"),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "Passwörter stimmen nicht überein",
    path: ["confirm"],
  });

function RouteComponent() {
  const { token, error } = Route.useSearch();
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { password: "", confirm: "" },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      if (!token) return;
      const { error: resetError } = await authClient.resetPassword({
        newPassword: value.password,
        token,
      });
      if (resetError) {
        toast.error("Zurücksetzen fehlgeschlagen. Fordere einen neuen Link an.");
        return;
      }
      toast.success("Passwort geändert. Melde dich jetzt an.");
      navigate({ to: "/auth/login" });
    },
  });

  const invalid = !token || Boolean(error);

  return (
    <AuthLayout
      title="Neues Passwort"
      subtitle="Wähle ein Passwort für dein Konto."
      footer={
        <>
          Zurück zur{" "}
          <Link to="/auth/login" className="font-semibold underline-offset-4 hover:underline">
            Anmeldung
          </Link>
        </>
      }
    >
      {invalid ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen an.
          </p>
          <Button size="lg" className="w-full" nativeButton={false}>
            <Link to="/auth/forgot-password">Neuen Link anfordern</Link>
          </Button>
        </div>
      ) : (
        <form
          id="reset-password-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <FieldGroup>
            <form.Field
              name="password"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Neues Passwort</FieldLabel>
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
            <form.Field
              name="confirm"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>Passwort wiederholen</FieldLabel>
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
                form="reset-password-form"
              >
                {isSubmitting ? "Wird gespeichert …" : "Passwort speichern"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      )}
    </AuthLayout>
  );
}
