import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CertificateCard, type CertificateDocument } from "@/components/learn/certificate-card";
import { LearningSummary } from "@/components/learn/learning-summary";
import { QueryError } from "@/components/query-error";
import { formatDate } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import type { Certificate } from "@nilovon-wiki/api/schemas/certificate";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button, buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Dialog, DialogContent, DialogTitle } from "@nilovon-wiki/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Award, Check, Copy, Printer, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_auth/learn/certificates")({
  component: RouteComponent,
});

/**
 * The certificate's own public address. Built from the current origin rather
 * than a configured base URL: this app is self-hosted, so the origin the holder
 * is looking at is the only one their verifiers can be told to open.
 */
function verificationUrl(serial: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/certificates/${encodeURIComponent(serial)}`;
}

/** The flat document shape, from the nested snapshot the holder's endpoint returns. */
function toDocument(row: Certificate): CertificateDocument {
  return {
    serial: row.serial,
    status: row.status,
    recipientName: row.subject.recipientName,
    courseTitle: row.subject.courseTitle,
    organizationName: row.subject.organizationName,
    completedAt: row.subject.completedAt,
    score: row.subject.score,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
  };
}

function RouteComponent() {
  const certificates = useQuery(orpc.learn.certificates.listMine.queryOptions({ input: {} }));
  // Which certificate is open as a document. One at a time, because the print
  // rules in `CertificateCard` target every document on the page.
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = certificates.data ?? [];
  const open = rows.find((row) => row.id === openId) ?? null;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Meine Zertifikate</h1>
          <p className="text-muted-foreground text-sm">
            Nachweise über abgeschlossene Kurse. Jedes Zertifikat lässt sich über seine Seriennummer
            öffentlich prüfen.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-3">
            {certificates.isError ? (
              <QueryError error={certificates.error} onRetry={() => void certificates.refetch()} />
            ) : certificates.isPending ? (
              <>
                {[0, 1].map((index) => (
                  <Skeleton key={index} className="h-32 w-full rounded-xl" />
                ))}
              </>
            ) : rows.length === 0 ? (
              <Empty className="rounded-xl border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Award className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>Noch keine Zertifikate</EmptyTitle>
                  <EmptyDescription>
                    Schließe einen Kurs ab, der ein Zertifikat vergibt — es erscheint danach hier.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="space-y-3">
                {rows.map((row) => (
                  <li key={row.id}>
                    <CertificateRow row={row} onOpen={() => setOpenId(row.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <LearningSummary />
          </aside>
        </div>
      </div>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          {open && (
            <>
              <DialogTitle className="sr-only">Zertifikat {open.serial}</DialogTitle>
              <CertificateCard
                certificate={toDocument(open)}
                verificationUrl={verificationUrl(open.serial)}
                className="border-none"
              >
                {/* Printing is the export path: the server has no PDF renderer,
                    and every browser's print dialog can save to PDF. */}
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="size-4" aria-hidden />
                  Drucken oder als PDF speichern
                </Button>
              </CertificateCard>
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

/**
 * One held certificate.
 *
 * A revoked one stays in the list, marked and with the stated reason: the
 * holder is the person most affected by the decision, and hiding the row would
 * leave them to discover it from whoever they sent the serial to.
 */
function CertificateRow({ row, onOpen }: { row: Certificate; onOpen: () => void }) {
  const revoked = row.status === "revoked";

  return (
    <Card className={cn("gap-3 p-4", revoked && "border-destructive/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{row.subject.courseTitle || "Kurs"}</h2>
            {revoked && <Badge variant="destructive">Widerrufen</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            Ausgestellt am {formatDate(row.issuedAt)}
            {row.subject.completedAt
              ? ` · Abgeschlossen am ${formatDate(row.subject.completedAt)}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onOpen}>
            Zertifikat ansehen
          </Button>
          <Link
            to="/certificates/$serial"
            params={{ serial: row.serial }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ShieldCheck className="size-4" aria-hidden />
            Öffentlich prüfen
          </Link>
        </div>
      </div>

      {revoked && (
        <p className="text-destructive text-sm">
          Widerrufen{row.revokedAt ? ` am ${formatDate(row.revokedAt)}` : ""}
          {row.revokedReason ? `: ${row.revokedReason}` : "."}
        </p>
      )}

      <SerialField serial={row.serial} />
    </Card>
  );
}

/**
 * The serial, copyable.
 *
 * It is the only thing a verifier needs, and it is routinely handed over in a
 * mail or a form — so it is `select-all` and one click away from the clipboard
 * rather than something to transcribe from a fixed-width string by eye.
 */
function SerialField({ serial }: { serial: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(serial);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context, which a plain-HTTP LAN install
      // does not have. The value is selectable, so say so instead of failing mute.
      toast.error("Kopieren nicht möglich — bitte die Seriennummer markieren und kopieren.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">Seriennummer</span>
      <code className="bg-muted/40 min-w-0 flex-1 truncate rounded-md border px-2 py-1 font-mono text-xs select-all">
        {serial}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={onCopy}
        aria-label="Seriennummer kopieren"
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}
