export type ExportFormat = "pdf" | "markdown" | "html" | "json";

/** Kept as the historical name for the Space-level format union. */
export type SpaceExportFormat = ExportFormat;

export const EXPORT_FORMATS: readonly ExportFormat[] = ["pdf", "markdown", "html", "json"];

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: "PDF",
  markdown: "Markdown",
  html: "HTML",
  json: "JSON",
};

export const EXPORT_FORMAT_HINT: Record<ExportFormat, string> = {
  pdf: "Zum Lesen, Drucken und Weitergeben",
  markdown: "Für Git, Obsidian und andere Wikis",
  html: "Eigenständige Seiten für den Browser",
  json: "Vollständige Struktur für Importer",
};

export function spaceExportUrl(serverUrl: string, spaceId: string, format: ExportFormat): string {
  return `${base(serverUrl)}/exports/spaces/${encodeURIComponent(spaceId)}?format=${format}`;
}

export function pageExportUrl(serverUrl: string, pageId: string, format: ExportFormat): string {
  return `${base(serverUrl)}/exports/pages/${encodeURIComponent(pageId)}?format=${format}`;
}

/**
 * Starts a download without leaving the page. The response carries
 * `Content-Disposition: attachment`, so the browser keeps the current view and
 * shows its own download progress — which matters for a PDF export that can
 * take a moment to render.
 */
export function startExportDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function base(serverUrl: string): string {
  return serverUrl.replace(/\/$/, "");
}
