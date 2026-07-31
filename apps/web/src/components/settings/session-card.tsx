import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { toastError } from "@/lib/query";
import { SettingsCard, SettingsSection } from "./settings-section";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

const SESSIONS_KEY = ["auth", "sessions"] as const;

type SessionRow = {
  id: string;
  token: string;
  createdAt: string | Date;
  expiresAt: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Reduces a raw UA string to something a person recognises. Deliberately crude:
 * it only has to tell one device apart from another in a list.
 */
function describeDevice(userAgent?: string | null): string {
  if (!userAgent) return "Unbekanntes Gerät";
  const browser = /Edg/.test(userAgent)
    ? "Edge"
    : /OPR|Opera/.test(userAgent)
      ? "Opera"
      : /Chrome/.test(userAgent)
        ? "Chrome"
        : /Safari/.test(userAgent)
          ? "Safari"
          : /Firefox/.test(userAgent)
            ? "Firefox"
            : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unbekannt";
  return `${browser} · ${os}`;
}

export function SessionCard() {
  const queryClient = useQueryClient();
  const { data: current } = authClient.useSession();
  const currentToken = current?.session.token;

  const sessionsQuery = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(result.error.message ?? "Laden fehlgeschlagen");
      return (result.data ?? []) as SessionRow[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });

  const revoke = useMutation({
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token });
      if (result.error) throw new Error(result.error.message ?? "Abmelden fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Sitzung beendet");
    },
    onError: toastError,
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions();
      if (result.error) throw new Error(result.error.message ?? "Abmelden fehlgeschlagen");
      return result.data;
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Alle anderen Sitzungen beendet");
    },
    onError: toastError,
  });

  const sessions = sessionsQuery.data ?? [];
  const others = sessions.filter((session) => session.token !== currentToken);

  return (
    <SettingsSection
      title="Aktive Sitzungen"
      description="Geräte, die gerade bei diesem Konto angemeldet sind."
      action={
        others.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            {revokeOthers.isPending ? "Wird beendet …" : "Andere abmelden"}
          </Button>
        ) : null
      }
    >
      <SettingsCard>
        {sessionsQuery.isPending ? (
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Sitzungen gefunden.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((session) => {
              const isCurrent = session.token === currentToken;
              return (
                <li
                  key={session.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <Monitor className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {describeDevice(session.userAgent)}
                      </span>
                      {isCurrent ? <Badge variant="secondary">Dieses Gerät</Badge> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {session.ipAddress ? `${session.ipAddress} · ` : ""}
                      seit {formatDateTime(session.createdAt)}
                    </div>
                  </div>
                  {isCurrent ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(session.token)}
                    >
                      Abmelden
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
