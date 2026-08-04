import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Fingerprint, ShieldBan, ShieldCheck } from "lucide-react";

import { BackLink, InstanceRoleBadge, LabelValue } from "@/components/admin/admin-ui";
import { UserActions } from "@/components/admin/user-actions";
import { UserSessions } from "@/components/admin/user-sessions";
import { QueryError } from "@/components/query-error";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { authClient } from "@/lib/auth-client";
import { formatDate, formatDateTime, initials, timeAgo } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/admin/users/$userId")({
  component: AdminUserDetail,
});

/**
 * One account, from the operator's side: who they are, how they sign in, which
 * organizations they belong to, and what can be done about it.
 *
 * Their pages and comments are deliberately absent. Metadata answers "is this
 * account healthy?"; reading content is a different question, and one that has
 * to go through impersonation so it leaves a trace.
 */
function AdminUserDetail() {
  const { userId } = Route.useParams();
  const { data: session } = authClient.useSession();
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.users.get.queryOptions({ input: { userId } }),
  );
  const { data: instance } = useQuery(orpc.admin.instance.overview.queryOptions({ input: {} }));

  if (isError) return <QueryError error={error} onRetry={() => void refetch()} />;

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <BackLink to="/admin/users">Alle Benutzer</BackLink>

      <header className="flex flex-wrap items-start gap-4">
        <Avatar className="size-14 shrink-0">
          {data.image ? <AvatarImage src={data.image} alt="" /> : null}
          <AvatarFallback className="text-lg">{initials(data.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <InstanceRoleBadge roles={data.roles} />
            {data.banned ? (
              <Badge variant="destructive" className="gap-1">
                <ShieldBan className="size-3" aria-hidden />
                Gesperrt
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{data.email}</p>
        </div>
      </header>

      {data.banned ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Dieses Konto ist gesperrt.</p>
          <p className="text-muted-foreground">
            Grund: {data.banReason || "kein Grund hinterlegt"}
            {data.banExpires
              ? ` · endet am ${formatDateTime(data.banExpires)}`
              : " · unbefristet, bis jemand die Sperre aufhebt"}
          </p>
        </div>
      ) : null}

      <SettingsSection
        title="Aktionen"
        description="Wirkt sofort und instanzweit — unabhängig von Organisations-Rollen."
      >
        <UserActions
          user={data}
          currentUserId={session?.user.id ?? ""}
          impersonationEnabled={instance?.impersonation.enabled ?? false}
        />
      </SettingsSection>

      <SettingsSection title="Konto" description="Identität und Anmeldeverfahren.">
        <SettingsCard>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <LabelValue label="Registriert">{formatDate(data.createdAt)}</LabelValue>
            <LabelValue label="Zuletzt angemeldet">
              {data.lastSeenAt ? timeAgo(data.lastSeenAt) : "Noch nie"}
            </LabelValue>
            <LabelValue label="E-Mail bestätigt">{data.emailVerified ? "Ja" : "Nein"}</LabelValue>
            <LabelValue label="Zwei-Faktor">
              {data.twoFactorEnabled ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-4" aria-hidden />
                  Aktiv
                </span>
              ) : (
                <span className="text-muted-foreground">Nicht eingerichtet</span>
              )}
            </LabelValue>
            <LabelValue label="Passkeys">
              <span className="inline-flex items-center gap-1.5">
                <Fingerprint className="size-4 text-muted-foreground" aria-hidden />
                {data.passkeyCount}
              </span>
            </LabelValue>
            <LabelValue label="Anmeldeverfahren">
              {data.providers.length ? data.providers.join(", ") : "—"}
            </LabelValue>
          </dl>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Organisationen"
        description="Mitgliedschaften und die dort vergebenen Rollen. Diese sind unabhängig von der Instanz-Rolle oben."
      >
        <SettingsCard className={data.organizations.length ? "divide-y divide-border py-0" : ""}>
          {data.organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Gehört keiner Organisation an — dieses Konto sieht nach der Anmeldung nur das
              Onboarding.
            </p>
          ) : (
            data.organizations.map((org) => (
              <div key={org.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link
                  to="/admin/organizations/$organizationId"
                  params={{ organizationId: org.id }}
                  className="min-w-0 flex-1 text-sm font-medium hover:underline"
                >
                  {org.name}
                </Link>
                <div className="flex flex-wrap gap-1.5">
                  {org.roles.map((role) => (
                    <Badge key={role} variant="outline">
                      {ROLE_LABEL[role] ?? role}
                    </Badge>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  seit {formatDate(org.joinedAt)}
                </span>
              </div>
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <UserSessions userId={data.id} userName={data.name} />
    </div>
  );
}
