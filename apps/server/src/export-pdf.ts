import { env } from "@nilovon-wiki/env/server";

import {
  documentToPdf,
  placeholderPdf,
  PdfRenderTimeout,
  type PdfImageLoader,
  type PdfRenderOptions,
} from "./pdf/document-to-pdf";
import type { PdfMeta } from "./pdf/pdf-theme";

/**
 * Resource policy for PDF exports.
 *
 * Rendering is CPU-bound and runs in the request, so a Space with thousands of
 * pages has to be bounded rather than trusted. Pages are rendered strictly one
 * after another, every page carries a timeout, and the page count has a
 * configurable ceiling. Nothing is dropped silently: a page beyond the ceiling
 * or past its timeout still gets a file in the archive, and the reason is
 * recorded in the manifest and in `EXPORT-REPORT.md`.
 */
export type PdfExportLimits = {
  maxPages: number;
  pageTimeoutMs: number;
  maxImageBytes: number;
  cacheBytes: number;
};

export function pdfExportLimits(): PdfExportLimits {
  return {
    maxPages: env.PDF_EXPORT_MAX_PAGES,
    pageTimeoutMs: env.PDF_EXPORT_PAGE_TIMEOUT_MS,
    // An image can never exceed the upload ceiling, so that is also the ceiling
    // for what a single embed may buffer.
    maxImageBytes: env.ATTACHMENT_MAX_MB * 1024 * 1024,
    cacheBytes: env.PDF_EXPORT_IMAGE_CACHE_MB * 1024 * 1024,
  };
}

export type RenderOutcome = "rendered" | "skipped" | "timeout" | "failed";

export type RenderedPdf = { bytes: Buffer; outcome: RenderOutcome; detail: string | null };

/** Renders one page, degrading to an explanatory placeholder PDF on failure. */
export async function renderPagePdf(
  content: unknown,
  meta: PdfMeta,
  options: { loadImage?: PdfImageLoader; resolveLink: (url: string) => string; timeoutMs: number },
): Promise<RenderedPdf> {
  const renderOptions: PdfRenderOptions = {
    loadImage: options.loadImage,
    resolveLink: options.resolveLink,
    timeoutMs: options.timeoutMs,
  };
  try {
    return {
      bytes: await documentToPdf(content, meta, renderOptions),
      outcome: "rendered",
      detail: null,
    };
  } catch (error) {
    const timedOut = error instanceof PdfRenderTimeout;
    const detail = timedOut
      ? `Zeitlimit von ${options.timeoutMs} ms überschritten.`
      : `Rendern fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`;
    return {
      bytes: await placeholderPdf(
        meta,
        `Diese Seite konnte nicht als PDF gerendert werden. ${detail}`,
      ),
      outcome: timedOut ? "timeout" : "failed",
      detail,
    };
  }
}

export type ReportEntry = { title: string; path: string; outcome: RenderOutcome; detail: string };

/**
 * Human-readable summary of everything the limits touched. Written into the
 * archive whenever at least one page did not render normally, so a truncated
 * export can never look like a complete one.
 */
export function buildExportReport(entries: ReportEntry[], limits: PdfExportLimits): string {
  const lines = [
    "# PDF-Export – Bericht",
    "",
    `Obergrenze: ${limits.maxPages} Seiten pro Export, ${limits.pageTimeoutMs} ms pro Seite.`,
    "",
    `${entries.length} Seite(n) wurden nicht vollständig gerendert:`,
    "",
    "| Seite | Datei | Ergebnis | Grund |",
    "| --- | --- | --- | --- |",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${escapeCell(entry.title)} | \`${entry.path}\` | ${entry.outcome} | ${escapeCell(entry.detail)} |`,
    );
  }
  lines.push(
    "",
    "Betroffene Dateien enthalten ein einseitiges PDF mit derselben Begründung.",
    "Die Obergrenzen lassen sich über `PDF_EXPORT_MAX_PAGES` und",
    "`PDF_EXPORT_PAGE_TIMEOUT_MS` anpassen.",
    "",
  );
  return lines.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
