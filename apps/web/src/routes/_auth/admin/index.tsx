import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { HealthRow, StatCard, formatBytes } from "@/components/admin/admin-ui";
import { QueryError } from "@/components/query-error";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/admin/")({
  component: InstanceOverview,
});

const numberFormat = new Intl.NumberFormat("de-DE");

/**
 * The page a support case starts on: version, size, and whether each external
 * dependency is actually reachable. Everything here answers "is this install
 * healthy?" — nothing here is about a single account.
 */
function InstanceOverview() {
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.instance.overview.queryOptions({ input: {} }),
  );

  if (isError) return <QueryError error={error} onRetry={() => void refetch()} />;

  const counts = data?.counts;

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Größe der Installation"
        description="Alle Organisationen zusammen — nicht nur die, in der du gerade arbeitest."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Benutzer"
            value={numberFormat.format(counts?.users ?? 0)}
            hint={
              counts
                ? `${counts.admins} Instanz-Admin${counts.admins === 1 ? "" : "s"} · ${counts.bannedUsers} gesperrt`
                : undefined
            }
            isPending={isPending}
          />
          <StatCard
            label="Organisationen"
            value={numberFormat.format(counts?.organizations ?? 0)}
            isPending={isPending}
          />
          <StatCard
            label="Spaces"
            value={numberFormat.format(counts?.spaces ?? 0)}
            hint={counts ? `${numberFormat.format(counts.pages)} Seiten` : undefined}
            isPending={isPending}
          />
          <StatCard
            label="Aktive Sitzungen"
            value={numberFormat.format(counts?.activeSessions ?? 0)}
            hint="Nicht abgelaufene Anmeldungen"
            isPending={isPending}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Dienste"
        description="Was diese Installation braucht — und ob sie es erreicht."
      >
        <SettingsCard className="divide-y divide-border py-1">
          {isPending || !data ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : (
            <>
              <HealthRow
                label="Objektspeicher"
                ok={data.storage.configured}
                okText={formatBytes(data.storage.usedBytes)}
                failText="Nicht konfiguriert"
                detail={
                  data.storage.bucket
                    ? `Bucket ${data.storage.bucket}`
                    : "Ohne S3_* sind Dateianhänge deaktiviert."
                }
              />
              <HealthRow
                label="E-Mail-Versand"
                ok={data.mail.configured}
                okText="Konfiguriert"
                failText="Nicht konfiguriert"
                detail={
                  data.mail.host ??
                  "Ohne SMTP_HOST erreichen Einladungen und Passwort-Resets niemanden."
                }
              />
              <HealthRow
                label="Echtzeit-Zusammenarbeit"
                ok={data.collab.reachable}
                okText="Erreichbar"
                failText="Nicht erreichbar"
                detail={data.collab.url}
              />
              <HealthRow
                label="Impersonation"
                ok={data.impersonation.enabled}
                okText={`Aktiv · ${data.impersonation.maxMinutes} Min.`}
                failText="Per Konfiguration deaktiviert"
                detail={
                  data.impersonation.enabled
                    ? "Sitzungen laufen automatisch ab und werden beidseitig protokolliert."
                    : "IMPERSONATION_ENABLED=false — serverseitig abgelehnt, nicht nur ausgeblendet."
                }
              />
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Version" description="Bitte bei jeder Support-Anfrage mit angeben.">
        <SettingsCard>
          {isPending ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <Badge variant="outline" className="font-mono text-sm">
              {data?.version}
            </Badge>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
