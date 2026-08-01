import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { ssoDomainRecordName } from "@nilovon-wiki/auth/sso-domain";
import { splitDomains, useIdentityRefresh } from "@/lib/identity-queries";
import { toastError } from "@/lib/query";
import { CopyField } from "./copy-field";
import { Button } from "@nilovon-wiki/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

/** The provider whose domain is being proven. */
export type DomainVerificationTarget = { providerId: string; domain: string };

/**
 * Proves control of the e-mail domain a provider claims.
 *
 * The check is what makes the provider usable at all — sign-in is refused until
 * it passes — and it is not busywork: the domain is what an address typed on the
 * sign-in screen is matched against, so without proof anyone who can administer
 * *some* organization could claim `gmail.com` and catch those sign-ins.
 *
 * The token is requested when the dialog opens, and re-requesting returns the
 * same value while it is valid (seven days), so re-opening does not invalidate a
 * record the operator already published.
 */
export function SSODomainDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Just the two fields the flow needs, not a whole provider: the dialog also
   * opens straight after registration, when the list has not refetched yet and
   * the values come from the register response.
   */
  target: DomainVerificationTarget | null;
}) {
  const refresh = useIdentityRefresh();
  const providerId = target?.providerId ?? null;

  const tokenQuery = useQuery({
    queryKey: ["identity", "ssoDomainToken", providerId],
    enabled: open && Boolean(providerId),
    // A verification token is a one-off handshake value, not cached state: a
    // stale one would have the operator publish a record that no longer matches.
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const result = await authClient.sso.requestDomainVerification({
        providerId: providerId as string,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Token konnte nicht angefordert werden");
      }
      return result.data as { domainVerificationToken: string };
    },
  });

  const verify = useMutation({
    mutationFn: async () => {
      const result = await authClient.sso.verifyDomain({ providerId: providerId as string });
      if (result.error) {
        throw new Error(
          /* The plugin answers 502 for "no matching TXT record found", which
             reads as a server fault but is almost always propagation delay. */
          /DOMAIN_VERIFICATION_FAILED|Unable to verify/i.test(result.error.message ?? "")
            ? "Der TXT-Eintrag wurde noch nicht gefunden. Nach dem Anlegen kann es bis zu einer Stunde dauern, bis er weltweit sichtbar ist."
            : (result.error.message ?? "Bestätigung fehlgeschlagen"),
        );
      }
      return result.data;
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Domain bestätigt — die Anmeldung über diesen Anbieter ist jetzt freigegeben");
      onOpenChange(false);
    },
    onError: toastError,
  });

  const domains = target ? splitDomains(target.domain) : [];
  const token = tokenQuery.data?.domainVerificationToken;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Domain bestätigen</DialogTitle>
          <DialogDescription>
            Lege den folgenden TXT-Eintrag im DNS an. Danach prüfen wir ihn — bis dahin ist die
            Anmeldung über diesen Anbieter gesperrt.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
          {tokenQuery.isPending ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : tokenQuery.isError ? (
            <p className="text-sm text-destructive">
              Der Bestätigungs-Token konnte nicht angefordert werden. Schließe den Dialog und
              versuche es erneut.
            </p>
          ) : token ? (
            <>
              {domains.map((domain) => (
                <CopyField
                  key={domain}
                  label={`Name (für ${domain})`}
                  value={ssoDomainRecordName(providerId as string, domain)}
                />
              ))}
              <CopyField label="Wert" value={token} />
              <p className="text-sm text-muted-foreground">
                Typ: <span className="font-mono">TXT</span>. Der Token ist sieben Tage gültig.
                {domains.length > 1
                  ? " Alle aufgeführten Domains brauchen je einen Eintrag."
                  : null}
              </p>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={verify.isPending}
          >
            Später
          </Button>
          <Button
            type="button"
            onClick={() => verify.mutate()}
            disabled={verify.isPending || !token}
          >
            {verify.isPending ? "Wird geprüft …" : "Jetzt prüfen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
