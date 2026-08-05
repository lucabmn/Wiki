import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive } from "lucide-react";

import { BackLink, LabelValue, StatCard, formatBytes } from "@/components/admin/admin-ui";
import { QueryError } from "@/components/query-error";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { formatDate } from "@/lib/format";
import { VISIBILITY_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/admin/organizations/$organizationId")({
  component: AdminOrganizationDetail,
});

const numberFormat = new Intl.NumberFormat("de-DE");

/**
 * One tenant, as far as an operator needs to see it: size, disk, and who owns
 * it. The space list stops at names and counts — no page titles, no content.
 * Answering "what is in there?" is a question for the organization's own
 * owners, or for an audited impersonation.
 */
function AdminOrganizationDetail() {
  const { organizationId } = Route.useParams();
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.organizations.get.queryOptions({ input: { organizationId } }),
  );

  if (isError) return <QueryError error={error} onRetry={() => void refetch()} />;
  if (isPending) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="space-y-8">
      <BackLink to="/admin/organizations">Alle Organisationen</BackLink>

      <header>
        <h2 className="text-lg font-semibold">{data.name}</h2>
        <p className="text-sm text-muted-foreground">
          {data.slug ? `/${data.slug} · ` : ""}angelegt am {formatDate(data.createdAt)}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Mitglieder" value={numberFormat.format(data.memberCount)} />
        <StatCard label="Spaces" value={numberFormat.format(data.spaceCount)} />
        <StatCard label="Seiten" value={numberFormat.format(data.pageCount)} />
        <StatCard label="Speicher" value={formatBytes(data.storageBytes)} hint="Dateianhänge" />
      </div>

      <SettingsSection
        title="Inhaber"
        description="Die Ansprechpartner dieser Organisation — nicht zu verwechseln mit Instanz-Administratoren."
      >
        <SettingsCard>
          {data.owners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Kein Inhaber eingetragen. Diese Organisation kann sich nicht selbst verwalten.
            </p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              {data.owners.map((owner) => (
                <LabelValue key={owner.id} label={owner.name}>
                  {owner.email}
                </LabelValue>
              ))}
            </dl>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Spaces"
        description="Nur Kennzahlen — Seiteninhalte zeigt die Instanz-Verwaltung bewusst nicht an."
      >
        <SettingsCard className={data.spaces.length ? "divide-y divide-border py-0" : ""}>
          {data.spaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">Diese Organisation hat keine Spaces.</p>
          ) : (
            data.spaces.map((space) => (
              <div key={space.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{space.name}</span>
                    <Badge variant="outline">
                      {VISIBILITY_LABEL[space.visibility] ?? space.visibility}
                    </Badge>
                    {space.archivedAt ? (
                      <Badge variant="secondary" className="gap-1">
                        <Archive className="size-3" aria-hidden />
                        Archiviert
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    /{space.slug} · zuletzt geändert {formatDate(space.updatedAt)}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground tabular-nums">
                  {numberFormat.format(space.pageCount)} Seiten
                  <br />
                  {formatBytes(space.storageBytes)}
                </div>
              </div>
            ))
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
