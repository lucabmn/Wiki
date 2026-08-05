import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { QueryError } from "@/components/query-error";
import { SettingsCard, SettingsSection } from "@/components/settings/settings-section";
import { formatDateTime, timeAgo } from "@/lib/format";
import { toastError } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/**
 * A user's live sessions, and the buttons that end them.
 *
 * This is the missing half of deprovisioning: disabling an account in the
 * directory means nothing while its browser tabs still hold a valid session.
 * Revocation bites immediately — the auth layer invalidates the cached session
 * cookie rather than waiting out its five-minute lifetime.
 */
export function UserSessions({ userId, userName }: { userId: string; userName: string }) {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery(
    orpc.admin.sessions.list.queryOptions({ input: { userId } }),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  };

  const revoke = useMutation(
    orpc.admin.sessions.revoke.mutationOptions({
      onSuccess: () => {
        toast.success("Sitzung beendet");
        invalidate();
      },
      onError: toastError,
    }),
  );

  const revokeAll = useMutation(
    orpc.admin.sessions.revokeAll.mutationOptions({
      onSuccess: () => {
        toast.success(`${userName} wurde auf allen Geräten abgemeldet`);
        invalidate();
      },
      onError: toastError,
    }),
  );

  return (
    <SettingsSection
      title="Aktive Sitzungen"
      description="Angemeldete Geräte. Beim Sperren oder Löschen enden sie ohnehin — hier lassen sie sich einzeln beenden."
      action={
        data && data.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={revokeAll.isPending}
            onClick={() => revokeAll.mutate({ userId })}
          >
            Alle beenden
          </Button>
        ) : null
      }
    >
      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <SettingsCard>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </SettingsCard>
      ) : data.length === 0 ? (
        <SettingsCard>
          <p className="text-sm text-muted-foreground">
            Zurzeit nirgends angemeldet — keine gültige Sitzung.
          </p>
        </SettingsCard>
      ) : (
        <SettingsCard className="divide-y divide-border py-0">
          {data.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 py-3">
              {entry.impersonatedBy ? (
                <UserRoundCog className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              ) : (
                <Monitor className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {entry.userAgent ?? "Unbekanntes Gerät"}
                  </span>
                  {entry.current ? <Badge variant="outline">Diese Sitzung</Badge> : null}
                  {entry.impersonatedBy ? <Badge variant="secondary">Übernommen</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {entry.ipAddress ? `${entry.ipAddress} · ` : ""}
                  angemeldet {timeAgo(entry.createdAt)} · läuft ab am{" "}
                  {formatDateTime(entry.expiresAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={revoke.isPending}
                title={
                  entry.current ? "Das beendet deine eigene Anmeldung an diesem Gerät." : undefined
                }
                onClick={() => revoke.mutate({ userId, sessionToken: entry.token })}
              >
                Beenden
              </Button>
            </div>
          ))}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}
