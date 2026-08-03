export type SpaceExportFormat = "markdown" | "html" | "json";

export function spaceExportUrl(
  serverUrl: string,
  spaceId: string,
  format: SpaceExportFormat,
): string {
  return `${serverUrl.replace(/\/$/, "")}/exports/spaces/${encodeURIComponent(spaceId)}?format=${format}`;
}
