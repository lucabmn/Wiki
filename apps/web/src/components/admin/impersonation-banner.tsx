import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UserRoundCog } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/query";
import { Button } from "@nilovon-wiki/ui/components/button";

/**
 * Persistent banner shown for the whole duration of an impersonated session.
 *
 * Mounted at the document root rather than inside a page, because the risk it
 * addresses is exactly forgetting: an admin who loses track of whose account
 * they are writing in will not go looking for a notice. It therefore sits above
 * everything, cannot be dismissed, and offers the way out in one click.
 *
 * The countdown is not decoration either — the session expires on its own
 * (IMPERSONATION_MAX_MINUTES), and work typed into an expired session would be
 * lost on submit.
 */
export function ImpersonationBanner() {
  const { data: session } = authClient.useSession();
  const impersonatedBy = session?.session.impersonatedBy;

  const stop = useMutation({
    mutationFn: async () => {
      const result = await authClient.admin.stopImpersonating();
      if (result.error) throw new Error(result.error.message ?? "Beenden fehlgeschlagen");
      return result.data;
    },
    // Full reload: every cached query belongs to the impersonated identity, and
    // an invalidation sweep would still race the new session cookie.
    onSuccess: () => {
      window.location.assign("/admin/users");
    },
    onError: toastError,
  });

  const remaining = useCountdown(session?.session.expiresAt);

  if (!impersonatedBy) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <UserRoundCog className="size-4 shrink-0" aria-hidden />
      <span>
        Du arbeitest als <strong>{session?.user.name ?? session?.user.email}</strong>. Alle Aktionen
        werden protokolliert.
      </span>
      {remaining ? (
        <span className="tabular-nums opacity-80">Endet automatisch in {remaining}</span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-amber-950/30 bg-amber-50 text-amber-950 hover:bg-white"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
      >
        {stop.isPending ? "Wird beendet …" : "Impersonation beenden"}
      </Button>
    </div>
  );
}

/** Coarse "in 24 Min." style countdown to `expiresAt`, or null once it has passed. */
function useCountdown(expiresAt: Date | string | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) return null;
  const end = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  const minutes = Math.floor((end - now) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return "weniger als 1 Min.";
  return `${minutes} Min.`;
}
