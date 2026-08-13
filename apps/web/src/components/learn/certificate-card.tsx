import { formatDate } from "@/lib/format";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { Award, ShieldOff } from "lucide-react";

/**
 * The facts a certificate states, flattened.
 *
 * Deliberately not one of the API's own types: the holder's endpoint nests them
 * under `subject` while the public verification endpoint returns them flat, and
 * this component has to render exactly the same document from either. Anything
 * only one of the two knows (ids, the revocation reason) is not on here, so the
 * document can never accidentally print what the verifier was not told.
 */
export type CertificateDocument = {
  serial: string;
  status: "issued" | "revoked";
  recipientName: string;
  courseTitle: string;
  organizationName: string;
  /** Null when the enrolment never carried a completion date. */
  completedAt: Date | null;
  /** Completion percentage at the moment of issue. */
  score: number | null;
  issuedAt: Date;
  revokedAt: Date | null;
};

/**
 * Print rules for the document.
 *
 * The browser's own "save as PDF" is the export path — the server has no PDF
 * renderer for certificates — so the printed page has to be the certificate and
 * nothing else. The rules live with the component rather than in a print-only
 * route because the document is shown inside two very different shells (the
 * dashboard, and the bare verification page), and neither of them is this
 * component's to reach into.
 *
 * Everything that is neither the document, inside it, nor an ancestor of it is
 * removed outright with `display: none`. The older trick of blanking the page
 * with `visibility: hidden` was tried first and is wrong here: hidden elements
 * keep their boxes, so a dashboard's worth of invisible layout still prints —
 * as trailing blank sheets. The ancestor chain is then flattened, because those
 * are the app's scroll containers and the dialog's fixed popup, and a document
 * left inside them prints clipped to whatever was on screen.
 *
 * Colours are pinned to ink-on-paper for the same reason `print-color-adjust`
 * is not used: in dark mode the token colours are light greys, which print as
 * an invisible certificate on the white paper the browser assumes.
 */
const PRINT_STYLES = `
@media print {
  @page { margin: 16mm; }
  html, body {
    background: #fff !important;
    height: auto !important;
    overflow: visible !important;
    display: block !important;
  }
  body *:not(:has([data-certificate-document])):not([data-certificate-document]):not([data-certificate-document] *) {
    display: none !important;
  }
  body :has([data-certificate-document]) {
    display: block !important;
    position: static !important;
    inset: auto !important;
    transform: none !important;
    width: auto !important;
    max-width: none !important;
    height: auto !important;
    max-height: none !important;
    /* Shells size themselves to the viewport (min-h-svh, h-full); left alone,
       an ancestor a screen tall becomes a blank second sheet. */
    min-height: 0 !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    box-shadow: none !important;
    background: none !important;
  }
  [data-certificate-document] {
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
    background: #fff !important;
    color: #111 !important;
  }
  [data-certificate-document] * { color: inherit !important; background: none !important; }
  [data-certificate-hairline] { border-color: #999 !important; }
  [data-print-hide] { display: none !important; }
}
`;

/**
 * A certificate rendered as the document it is, not as a row in a list.
 *
 * Only one of these should be on screen at a time: the print rules above match
 * every `[data-certificate-document]` on the page, so a second one would print
 * on the same sheet.
 */
export function CertificateCard({
  certificate,
  verificationUrl,
  className,
  children,
}: {
  certificate: CertificateDocument;
  /** Printed under the serial so a paper copy can be checked years later. */
  verificationUrl?: string;
  className?: string;
  /** Screen-only chrome (a print button); never reaches the paper. */
  children?: React.ReactNode;
}) {
  const revoked = certificate.status === "revoked";

  return (
    <>
      <style>{PRINT_STYLES}</style>

      <article
        data-certificate-document
        aria-label={`Zertifikat ${certificate.serial}`}
        className={cn(
          "bg-card text-card-foreground relative overflow-hidden rounded-xl border p-8 sm:p-12",
          className,
        )}
      >
        {/* A revoked certificate must never be printable as a valid one. The
            notice sits inside the document, above the statement it contradicts,
            rather than in the surrounding page chrome — the chrome does not get
            printed. */}
        {revoked && (
          <div
            data-certificate-hairline
            className="border-destructive/40 text-destructive mb-8 flex items-start gap-2 rounded-lg border border-dashed px-4 py-3 text-sm"
          >
            <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="font-medium">
              Dieses Zertifikat wurde widerrufen
              {certificate.revokedAt ? ` am ${formatDate(certificate.revokedAt)}` : ""} und ist
              nicht mehr gültig.
            </p>
          </div>
        )}

        <div className={cn("space-y-8 text-center", revoked && "opacity-60")}>
          <header className="space-y-3">
            <Award className="mx-auto size-9 opacity-70" aria-hidden />
            <p className="text-xs tracking-[0.28em] uppercase opacity-70">
              {certificate.organizationName}
            </p>
            {/* Not an `h1`: both surfaces that mount this already have one (the
                list page, and the verification page's own header), and the
                dialog would otherwise put a second one on the same document. */}
            <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Zertifikat
            </h2>
          </header>

          <div
            data-certificate-hairline
            className="mx-auto max-w-xl space-y-4 border-y py-8 text-balance"
          >
            <p className="text-sm opacity-70">Hiermit wird bestätigt, dass</p>
            <p className="font-serif text-2xl font-semibold sm:text-3xl">
              {certificate.recipientName}
            </p>
            <p className="text-sm opacity-70">den Kurs</p>
            <p className="font-serif text-xl font-medium sm:text-2xl">{certificate.courseTitle}</p>
            <p className="text-sm opacity-70">
              erfolgreich abgeschlossen hat
              {certificate.completedAt ? ` am ${formatDate(certificate.completedAt)}` : ""}.
            </p>
            {certificate.score !== null && (
              <p className="text-sm opacity-70">
                Erreichter Fortschritt: {Math.round(certificate.score)} %
              </p>
            )}
          </div>

          {/* The footer is the part a verifier actually works with, so serial
              and date stay legible in monospace rather than being tucked into
              a decorative flourish. */}
          <footer className="space-y-1 text-xs opacity-70">
            <p>Ausgestellt am {formatDate(certificate.issuedAt)}</p>
            <p className="font-mono break-all select-all">{certificate.serial}</p>
            {verificationUrl && <p className="break-all">Prüfen unter {verificationUrl}</p>}
          </footer>
        </div>

        {children ? (
          <div data-print-hide className="mt-8 flex justify-center print:hidden">
            {children}
          </div>
        ) : null}
      </article>
    </>
  );
}
