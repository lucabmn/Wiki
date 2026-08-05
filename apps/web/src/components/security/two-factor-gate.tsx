import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, X } from "lucide-react";

import { orpc } from "@/utils/orpc";
import { formatRemaining, isUrgent, SECURITY_SETTINGS_PATH } from "@/lib/two-factor";
import { TwoFactorBlockScreen } from "./two-factor-block-screen";
import { Button } from "@nilovon-wiki/ui/components/button";
import { cn } from "@nilovon-wiki/ui/lib/utils";

/**
 * Enforces the organization's two-factor policy in the UI.
 *
 * The server already refuses every protected procedure for a blocked caller —
 * this is what turns that refusal into an explanation instead of a wall of
 * failed requests. The status endpoint it reads is exempt from the policy, so
 * it answers even for someone who may do nothing else.
 *
 * While the status is still loading the app renders normally: the policy is off
 * in almost every organization, and flashing a spinner over the whole shell on
 * every page load to catch the rare case is the wrong trade.
 */
export function TwoFactorGate({
  organizationName,
  children,
}: {
  organizationName: string;
  children: ReactNode;
}) {
  const { data } = useTwoFactorStatus();

  if (data?.status === "blocked") {
    return <TwoFactorBlockScreen organizationName={organizationName} />;
  }
  return <>{children}</>;
}

/**
 * The countdown a member sees while the grace period runs. Rendered *inside*
 * the app shell rather than by the gate above it: the shell is pinned to the
 * viewport height, so a sibling banner would push it off screen.
 *
 * Shares the gate's query — React Query dedupes, so this costs no extra request.
 */
export function TwoFactorGraceBanner() {
  const { data } = useTwoFactorStatus();

  if (data?.status !== "grace" || !data.graceUntil) return null;
  return <GraceBanner deadline={new Date(data.graceUntil)} />;
}

function useTwoFactorStatus() {
  return useQuery(orpc.securityPolicy.getMyTwoFactorStatus.queryOptions({ input: {} }));
}

/** Dismissals last for the tab, not forever — the deadline does not go away. */
const DISMISS_KEY = "two-factor-grace-dismissed";

function GraceBanner({ deadline }: { deadline: Date }) {
  const urgent = isUrgent(deadline);
  const [dismissed, setDismissed] = useState(false);

  // Read on mount rather than during render so SSR and the first client render
  // agree. An urgent banner ignores any earlier dismissal.
  useEffect(() => {
    if (urgent) return;
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
  }, [urgent]);

  // Keeps "noch 3 Stunden" honest on a tab left open overnight without ticking
  // every second: the copy only ever changes by the minute at its finest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm",
        urgent
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
      )}
    >
      <ShieldAlert className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Zwei-Faktor-Authentifizierung wird Pflicht</span> —{" "}
        {formatRemaining(deadline)}. Danach ist der Zugriff gesperrt, bis ein zweiter Faktor
        eingerichtet ist.
      </p>
      {/* `default` rather than `destructive`: the destructive variant is a soft
          tint, which disappears on the tinted banner it would sit on. */}
      <Button
        size="sm"
        variant={urgent ? "default" : "secondary"}
        nativeButton={false}
        render={<Link to={SECURITY_SETTINGS_PATH} />}
      >
        Jetzt einrichten
      </Button>
      {urgent ? null : (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Hinweis für diese Sitzung ausblenden"
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
