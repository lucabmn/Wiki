import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import {
  SCIM_BASE_URL,
  scimConnectionsQueryOptions,
  splitDomains,
  ssoProvidersQueryOptions,
  useIdentityRefresh,
  type SCIMConnection,
  type SSOProvider,
} from "@/lib/identity-queries";
import { toastError } from "@/lib/query";
import { CopyField } from "@/components/settings/copy-field";
import { OrgAdminGate } from "@/components/settings/org-admin-gate";
import { SCIMConnectionDialog } from "@/components/settings/scim-connection-dialog";
import {
  SSODomainDialog,
  type DomainVerificationTarget,
} from "@/components/settings/sso-domain-dialog";
import { SSOProviderDialog } from "@/components/settings/sso-provider-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
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
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Field, FieldLabel } from "@nilovon-wiki/ui/components/field";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/settings/sso")({
  component: () => (
    <OrgAdminGate>
      <SingleSignOnSettings />
    </OrgAdminGate>
  ),
});

function SingleSignOnSettings() {
  const { auth } = Route.useRouteContext();
  const organizationId = auth.organization.id;

  return (
    <div className="space-y-8">
      <ProvidersSection organizationId={organizationId} />
      <DirectorySection organizationId={organizationId} />
    </div>
  );
}

/* ── Identity providers ──────────────────────────────────────────────────── */

function ProvidersSection({ organizationId }: { organizationId: string }) {
  const providersQuery = useQuery(ssoProvidersQueryOptions(organizationId));
  const providers = providersQuery.data ?? [];

  // `undefined` = closed, `null` = create, provider = edit. Same tri-state the
  // teams tab uses, so the dialog mounts once and never flashes empty on close.
  const [editorTarget, setEditorTarget] = useState<SSOProvider | null | undefined>(undefined);
  const [domainTarget, setDomainTarget] = useState<DomainVerificationTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SSOProvider | null>(null);

  return (
    <SettingsSection
      title="Identitätsanbieter"
      description="Anmeldung über euren Identitätsanbieter (OIDC). Wer sich so anmeldet, wird automatisch Mitglied dieser Organisation."
      action={
        providers.length > 0 ? (
          <Button size="sm" onClick={() => setEditorTarget(null)}>
            <Plus className="size-4" /> Anbieter verbinden
          </Button>
        ) : null
      }
    >
      {providersQuery.isPending ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : providers.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound />
            </EmptyMedia>
            <EmptyTitle>Noch kein Anbieter verbunden</EmptyTitle>
            <EmptyDescription>
              Mit Entra ID, Okta, Keycloak oder Google Workspace melden sich alle mit ihrem
              Arbeitskonto an — ohne zusätzliches Passwort in diesem Wiki.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setEditorTarget(null)}>
              <Plus className="size-4" /> Anbieter verbinden
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.providerId}
              provider={provider}
              onEdit={() => setEditorTarget(provider)}
              onVerify={() =>
                setDomainTarget({ providerId: provider.providerId, domain: provider.domain })
              }
              onDelete={() => setDeleteTarget(provider)}
            />
          ))}
        </div>
      )}

      <SSOProviderDialog
        open={editorTarget !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditorTarget(undefined);
        }}
        organizationId={organizationId}
        existing={editorTarget ?? null}
        onCreated={setDomainTarget}
      />

      <SSODomainDialog
        open={domainTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDomainTarget(null);
        }}
        target={domainTarget}
      />

      <DeleteProviderDialog provider={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </SettingsSection>
  );
}

function ProviderCard({
  provider,
  onEdit,
  onVerify,
  onDelete,
}: {
  provider: SSOProvider;
  onEdit: () => void;
  onVerify: () => void;
  onDelete: () => void;
}) {
  const domains = splitDomains(provider.domain);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{provider.providerId}</span>
            {provider.domainVerified ? (
              <Badge variant="secondary">
                <BadgeCheck className="size-3" /> Aktiv
              </Badge>
            ) : (
              <Badge variant="outline">
                <ShieldAlert className="size-3" /> Domain unbestätigt
              </Badge>
            )}
            <Badge variant="outline">{provider.type === "saml" ? "SAML" : "OIDC"}</Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {domains.join(", ")} · {provider.issuer}
          </div>
          {provider.oidcConfig?.clientIdLastFour ? (
            <div className="font-mono text-xs text-muted-foreground">
              Client-ID {provider.oidcConfig.clientIdLastFour}
            </div>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" title="Aktionen">
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Aktionen</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {provider.domainVerified ? null : (
              <DropdownMenuItem onClick={onVerify}>Domain bestätigen</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onEdit}>Bearbeiten</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              Entfernen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {provider.domainVerified ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="min-w-0 text-sm">
            Die Anmeldung ist gesperrt, bis {domains.length > 1 ? "die Domains" : "die Domain"}{" "}
            <strong>{domains.join(", ")}</strong> per DNS bestätigt{" "}
            {domains.length > 1 ? "sind" : "ist"}.
          </p>
          <Button size="sm" variant="outline" onClick={onVerify}>
            Domain bestätigen
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Removing a provider is not just a config change: Better Auth deletes every
 * `account` row linked to it, and anyone who only ever signed in through this
 * provider has no other credential. Hence the type-to-confirm, matching the
 * organization danger zone.
 */
function DeleteProviderDialog({
  provider,
  onClose,
}: {
  provider: SSOProvider | null;
  onClose: () => void;
}) {
  const refresh = useIdentityRefresh();
  const [confirmation, setConfirmation] = useState("");

  const remove = useMutation({
    mutationFn: async (providerId: string) => {
      const result = await authClient.sso.deleteProvider({ providerId });
      if (result.error) throw new Error(result.error.message ?? "Entfernen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Anbieter entfernt");
      onClose();
    },
    onError: toastError,
  });

  return (
    <AlertDialog
      open={provider !== null}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmation("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>„{provider?.providerId}" entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            Alle über diesen Anbieter verknüpften Anmeldungen werden gelöscht. Wer sich bisher nur
            so angemeldet hat, kommt danach nicht mehr hinein — die Konten und ihre Inhalte bleiben
            bestehen, brauchen aber eine neue Anmeldemethode. Tippe zur Bestätigung die Anbieter-ID
            ein.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="sso-delete-confirm">Anbieter-ID</FieldLabel>
          <Input
            id="sso-delete-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={provider?.providerId}
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending || confirmation.trim() !== provider?.providerId}
            onClick={() => {
              if (provider) remove.mutate(provider.providerId);
            }}
          >
            {remove.isPending ? "Entfernen …" : "Endgültig entfernen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Directory sync (SCIM) ───────────────────────────────────────────────── */

function DirectorySection({ organizationId }: { organizationId: string }) {
  const connectionsQuery = useQuery(scimConnectionsQueryOptions(organizationId));
  const connections = connectionsQuery.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<SCIMConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SCIMConnection | null>(null);

  return (
    <SettingsSection
      title="Verzeichnis-Synchronisierung (SCIM)"
      description="Dein Identitätsanbieter legt Mitglieder selbst an und entfernt sie wieder. Ohne SCIM entsteht ein Konto erst bei der ersten Anmeldung."
      action={
        connections.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Verbindung
          </Button>
        ) : null
      }
    >
      {connectionsQuery.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : connections.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Keine Synchronisierung eingerichtet</EmptyTitle>
            <EmptyDescription>
              Optional. Sinnvoll, sobald Ein- und Austritte im Identitätsanbieter gepflegt werden
              und hier ohne Zutun ankommen sollen.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Verbindung erstellen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-3">
          <CopyField
            label="SCIM-Basis-URL"
            value={SCIM_BASE_URL}
            description="Gilt für alle Verbindungen dieser Organisation."
          />
          {connections.map((connection) => (
            <Card key={connection.id} className="gap-0 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{connection.providerId}</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" title="Aktionen">
                        <MoreHorizontal className="size-4" />
                        <span className="sr-only">Aktionen</span>
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRotateTarget(connection)}>
                      <RefreshCw className="size-4" /> Token erneuern
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteTarget(connection)}
                    >
                      Verbindung entfernen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      <SCIMConnectionDialog
        open={createOpen || rotateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setRotateTarget(null);
          }
        }}
        organizationId={organizationId}
        rotateProviderId={rotateTarget?.providerId ?? null}
      />

      <DeleteConnectionDialog connection={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </SettingsSection>
  );
}

function DeleteConnectionDialog({
  connection,
  onClose,
}: {
  connection: SCIMConnection | null;
  onClose: () => void;
}) {
  const refresh = useIdentityRefresh();

  const remove = useMutation({
    mutationFn: async (providerId: string) => {
      const result = await authClient.scim.deleteProviderConnection({ providerId });
      if (result.error) throw new Error(result.error.message ?? "Entfernen fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Verbindung entfernt");
      onClose();
    },
    onError: toastError,
  });

  return (
    <AlertDialog
      open={connection !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Verbindung entfernen?</AlertDialogTitle>
          <AlertDialogDescription>
            Der Token wird ungültig und der Identitätsanbieter kann keine Mitglieder mehr anlegen
            oder deaktivieren. Bereits synchronisierte Mitglieder bleiben, wie sie sind.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => {
              if (connection) remove.mutate(connection.providerId);
            }}
          >
            {remove.isPending ? "Entfernen …" : "Entfernen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
