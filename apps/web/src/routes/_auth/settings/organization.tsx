import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import type { PermissionRequest } from "@nilovon-wiki/auth/permissions";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { usePermission } from "@/lib/permissions";
import { toastError } from "@/lib/query";
import { useOrgRefresh } from "@/lib/org-queries";
import { PermissionGate } from "@/components/settings/permission-gate";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@nilovon-wiki/ui/components/alert-dialog";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";

const ORG_UPDATE: PermissionRequest[] = [{ organization: ["update"] }];

export const Route = createFileRoute("/_auth/settings/organization")({
  component: () => (
    <PermissionGate permissions={ORG_UPDATE}>
      <OrganizationSettings />
    </PermissionGate>
  ),
});

// Better Auth looks organizations up by slug, so it must stay URL-safe and
// stable — the same shape the onboarding form enforces.
const slugSchema = z
  .string()
  .min(2, "Mindestens 2 Zeichen")
  .max(48, "Höchstens 48 Zeichen")
  .regex(/^[a-z0-9-]+$/, "Nur Kleinbuchstaben, Ziffern und Bindestriche");

function OrganizationSettings() {
  const { auth } = Route.useRouteContext();
  const organization = auth.organization;

  return (
    <div className="space-y-8">
      <GeneralForm
        organizationId={organization.id}
        name={organization.name}
        slug={organization.slug}
        logo={organization.logo ?? ""}
      />
      <DangerZone organizationId={organization.id} name={organization.name} />
    </div>
  );
}

function GeneralForm({
  organizationId,
  name,
  slug,
  logo,
}: {
  organizationId: string;
  name: string;
  slug: string;
  logo: string;
}) {
  const router = useRouter();
  const refresh = useOrgRefresh();
  const [nextName, setNextName] = useState(name);
  const [nextSlug, setNextSlug] = useState(slug);
  const [nextLogo, setNextLogo] = useState(logo);
  const [slugError, setSlugError] = useState<string | null>(null);

  useEffect(() => setNextName(name), [name]);
  useEffect(() => setNextSlug(slug), [slug]);
  useEffect(() => setNextLogo(logo), [logo]);

  const save = useMutation({
    mutationFn: async () => {
      const result = await authClient.organization.update({
        organizationId,
        data: {
          name: nextName.trim(),
          slug: nextSlug.trim(),
          logo: nextLogo.trim() === "" ? null : nextLogo.trim(),
        },
      });
      if (result.error) throw new Error(result.error.message ?? "Speichern fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      await router.invalidate();
      toast.success("Organisation gespeichert");
    },
    onError: toastError,
  });

  const submit = () => {
    const parsed = slugSchema.safeParse(nextSlug.trim());
    if (!parsed.success) {
      setSlugError(parsed.error.issues[0]?.message ?? "Ungültiger Slug");
      return;
    }
    setSlugError(null);
    save.mutate();
  };

  const dirty = nextName.trim() !== name || nextSlug.trim() !== slug || nextLogo.trim() !== logo;

  return (
    <SettingsSection
      title="Organisation"
      description="Name, Kurzname und Logo — sichtbar für alle Mitglieder."
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
            <FieldLabel htmlFor="org-name">Name</FieldLabel>
            <Input
              id="org-name"
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
            />
          </Field>

          <Field data-invalid={slugError ? true : undefined}>
            <FieldLabel htmlFor="org-slug">Kurzname (Slug)</FieldLabel>
            <Input
              id="org-slug"
              value={nextSlug}
              onChange={(event) => {
                setNextSlug(event.target.value);
                if (slugError) setSlugError(null);
              }}
              aria-invalid={slugError ? true : undefined}
            />
            {slugError ? (
              <FieldError>{slugError}</FieldError>
            ) : (
              <FieldDescription>
                Muss organisationsübergreifend eindeutig sein. Nur Kleinbuchstaben, Ziffern und
                Bindestriche.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="org-logo">Logo-URL</FieldLabel>
            <Input
              id="org-logo"
              type="url"
              value={nextLogo}
              onChange={(event) => setNextLogo(event.target.value)}
              placeholder="https://…/logo.png"
            />
            <FieldDescription>
              Optional. Leer lassen für den Initialen-Platzhalter.
            </FieldDescription>
          </Field>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!dirty || save.isPending || !nextName.trim()}>
              {save.isPending ? "Speichern …" : "Speichern"}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </SettingsSection>
  );
}

/**
 * Deleting the organization is `organization:["delete"]` — an owner-only right by
 * default, which is why it is checked separately from the update rights that let
 * an admin reach this tab at all.
 */
function DangerZone({ organizationId, name }: { organizationId: string; name: string }) {
  const router = useRouter();
  const { allowed, isPending } = usePermission({ organization: ["delete"] });
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const remove = useMutation({
    mutationFn: async () => {
      const result = await authClient.organization.delete({ organizationId });
      if (result.error) throw new Error(result.error.message ?? "Löschen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success("Organisation gelöscht");
      // The SSR auth middleware picks the next membership (or sends the user to
      // onboarding); a hard navigation is the simplest way to re-run it.
      await router.navigate({ to: "/", reloadDocument: true });
    },
    onError: toastError,
  });

  if (isPending || !allowed) return null;

  return (
    <SettingsSection
      title="Gefahrenzone"
      description="Aktionen hier lassen sich nicht rückgängig machen."
    >
      <SettingsCard className="border-destructive/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Organisation löschen</div>
            <p className="text-sm text-muted-foreground">
              Entfernt alle Spaces, Seiten und Mitgliedschaften dieser Organisation.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
            Löschen
          </Button>
        </div>
      </SettingsCard>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setConfirmation("");
          setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{name}" endgültig löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Alle Inhalte dieser Organisation gehen verloren. Tippe zur Bestätigung den Namen der
              Organisation ein.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="org-delete-confirm">Name der Organisation</FieldLabel>
            <Input
              id="org-delete-confirm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={name}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending || confirmation.trim() !== name}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Löschen …" : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
