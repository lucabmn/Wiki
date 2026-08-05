import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { PasskeyCard } from "@/components/settings/passkey-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { Button } from "@nilovon-wiki/ui/components/button";

/**
 * What a member sees once their organization's grace period has run out.
 *
 * It carries the *setup* inline rather than linking to `/settings/security`,
 * for two reasons. Every other screen in the app is now refused by the server,
 * so navigating there would render a shell whose every query 403s; and the last
 * thing someone locked out of their wiki needs is a page telling them to go
 * somewhere else. Both cards below talk to Better Auth's `/api/auth/*`, which
 * the policy deliberately does not gate — otherwise this screen could not work.
 */
export function TwoFactorBlockScreen({ organizationName }: { organizationName: string }) {
  useRecheckOnEnrolment();

  const signOut = async () => {
    await authClient.signOut();
    window.location.assign("/auth/login");
  };

  return (
    <div className="min-h-svh overflow-y-auto bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-8">
        <header className="space-y-3 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Zwei-Faktor-Authentifizierung erforderlich</h1>
          <p className="text-sm text-muted-foreground">
            {organizationName} verlangt einen zweiten Faktor. Richte eine Authenticator-App oder
            einen Passkey ein — beides genügt, und danach geht es sofort weiter.
          </p>
        </header>

        <TwoFactorCard enabled={false} />
        <PasskeyCard />

        <div className="flex justify-center border-t border-border pt-6">
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4" />
            Abmelden
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lets the user back in the moment they finish enrolling, without a reload.
 *
 * Both signals are client-side state Better Auth already keeps fresh, so this
 * watches them instead of polling the policy endpoint: the session's
 * `twoFactorEnabled` flips when TOTP is verified, and the passkey list grows
 * when one is registered.
 */
function useRecheckOnEnrolment(): void {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const { data: passkeys } = authClient.useListPasskeys();

  const enrolled = Boolean(session?.user.twoFactorEnabled) || (passkeys?.length ?? 0) > 0;

  useEffect(() => {
    if (!enrolled) return;
    toast.success("Zweiter Faktor eingerichtet — willkommen zurück");
    void queryClient.invalidateQueries({ queryKey: orpc.securityPolicy.key() });
  }, [enrolled, queryClient]);
}
