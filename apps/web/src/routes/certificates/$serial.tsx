import { CertificateCard, type CertificateDocument } from "@/components/learn/certificate-card";
import { QueryError } from "@/components/query-error";
import { formatDate } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleCheck, CircleHelp, Printer, ShieldOff } from "lucide-react";

export const Route = createFileRoute("/certificates/$serial")({
  component: RouteComponent,
});

/**
 * The page a stranger opens from a printed certificate.
 *
 * Deliberately outside the `_auth` layout: whoever is checking a qualification
 * — a recruiter, a client's compliance desk — has no account here and never
 * will, so a sign-in wall would make the serial printed on the paper useless.
 * That also decides the rest of the page. It carries its own chrome instead of
 * the dashboard's, and it links nowhere into the app: an unauthenticated
 * visitor following such a link would only be bounced to a login form, and the
 * page would read as a funnel rather than as a statement of fact.
 *
 * Everything it shows comes from `certificates.verify`, which answers with the
 * snapshot facts and the status and nothing else — no ids, no email, not even
 * the revocation reason. Nothing is joined on top of that here.
 */
function RouteComponent() {
  const { serial } = Route.useParams();

  // Not `verify.queryOptions`: an unknown serial is this page's most ordinary
  // outcome, and as a rejected query it would fire the global error toast
  // ("Der Inhalt wurde nicht gefunden") over a page whose entire job is to say
  // so calmly. It is folded into the data as `null` instead; anything that is
  // not about this serial is a real failure and still throws.
  //
  // BAD_REQUEST lands in the same bucket as NOT_FOUND on purpose. The endpoint
  // caps the serial at 64 characters, and a mistyped or truncated code that
  // overshoots it is the same situation as one that simply does not exist —
  // telling the verifier their input was "ungültig" would suggest the app,
  // rather than the code they were handed, is what went wrong.
  const verification = useQuery({
    queryKey: orpc.learn.certificates.verify.key({ input: { serial } }),
    queryFn: async () => {
      try {
        return await client.learn.certificates.verify({ serial });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "NOT_FOUND" || code === "BAD_REQUEST") return null;
        throw error;
      }
    },
    retry: false,
  });

  return (
    <div className="bg-muted/30 flex min-h-svh flex-col">
      <header className="border-b bg-background px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-baseline gap-2">
          <h1 className="text-sm font-semibold">Zertifikatsprüfung</h1>
          <span className="text-muted-foreground truncate font-mono text-xs">{serial}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4 md:p-6">
        {verification.isError ? (
          <QueryError
            error={verification.error}
            onRetry={() => void verification.refetch()}
            className="bg-background"
          />
        ) : verification.isPending ? (
          <>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </>
        ) : verification.data === null ? (
          <Verdict
            tone="unknown"
            icon={CircleHelp}
            title="Kein Zertifikat mit dieser Seriennummer"
            detail="Prüfe die Schreibweise der Seriennummer. Wurde sie korrekt übertragen, gibt es zu diesem Nachweis keinen Eintrag."
          />
        ) : (
          <Result data={verification.data} />
        )}
      </main>

      <footer className="text-muted-foreground px-4 py-6 text-center text-xs">
        Die Angaben stammen aus dem Nachweis, wie er bei der Ausstellung festgehalten wurde.
      </footer>
    </div>
  );
}

/** The verdict plus the document it is about. */
function Result({ data }: { data: CertificateDocument }) {
  const revoked = data.status === "revoked";

  return (
    <>
      {revoked ? (
        <Verdict
          tone="revoked"
          icon={ShieldOff}
          title="Dieses Zertifikat wurde widerrufen"
          detail={
            data.revokedAt
              ? `Widerrufen am ${formatDate(data.revokedAt)}. Es ist seitdem nicht mehr gültig.`
              : "Es ist nicht mehr gültig."
          }
        />
      ) : (
        <Verdict
          tone="valid"
          icon={CircleCheck}
          title="Dieses Zertifikat ist gültig"
          detail={`Ausgestellt von ${data.organizationName}.`}
        />
      )}

      <CertificateCard certificate={data} className="bg-background">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Drucken oder als PDF speichern
        </Button>
      </CertificateCard>
    </>
  );
}

/**
 * The answer, stated before the document.
 *
 * Three outcomes, each with its own colour and its own words — a verifier who
 * skims must not be able to mistake a revoked certificate for a valid one, and
 * "not found" must not look like an error the page had.
 */
function Verdict({
  tone,
  icon: Icon,
  title,
  detail,
}: {
  tone: "valid" | "revoked" | "unknown";
  icon: typeof CircleCheck;
  title: string;
  detail: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4",
        tone === "valid" && "border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/30",
        tone === "revoked" && "border-destructive/30 bg-destructive/5",
        tone === "unknown" && "bg-background",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          tone === "valid" && "text-emerald-600 dark:text-emerald-400",
          tone === "revoked" && "text-destructive",
          tone === "unknown" && "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{detail}</p>
      </div>
    </div>
  );
}
