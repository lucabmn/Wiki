import { ORPCError } from "@orpc/server";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Shared plumbing for the plain Hono routes that live outside oRPC (binary
 * transfer, exports). Their `message` reaches people directly — as an upload
 * toast, or as the page a failed download link opens — so it is German, like
 * the rest of the UI.
 */
export const MESSAGES = {
  unauthorized: "Bitte melde dich an.",
  noFile: "Es wurde keine Datei übermittelt.",
  invalidForm: "Die Anfrage konnte nicht gelesen werden.",
  storageDisabled: "Datei-Uploads sind auf dieser Instanz nicht eingerichtet.",
  notInline: "Dieser Dateityp kann nicht inline angezeigt werden.",
  invalidFormat: "Unbekanntes Exportformat. Erlaubt sind markdown, html, json und pdf.",
  tooLarge: (maxMb: number) => `Die Datei ist größer als ${maxMb} MB.`,
} as const;

/** Maps an oRPC error onto the HTTP status its RPC counterpart would return. */
export function errorResponse(c: Context, error: unknown) {
  if (error instanceof ORPCError) {
    return c.json({ message: error.message }, (error.status || 500) as ContentfulStatusCode);
  }
  throw error;
}

/** Parses a multipart body, or returns null when the client sent something malformed. */
export async function readFormData(c: Context): Promise<FormData | null> {
  try {
    return await c.req.formData();
  } catch {
    return null;
  }
}
