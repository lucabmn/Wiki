import { formatDateTime } from "./format";

/**
 * German labels for `admin.admin_audit_action`.
 *
 * Ordered as the console groups them — account lifecycle, then session control,
 * then impersonation — because the filter dropdown renders this map directly.
 */
export const ADMIN_AUDIT_LABEL = {
  "user.created": "Konto angelegt",
  "user.role_changed": "Rolle geändert",
  "user.banned": "Gesperrt",
  "user.unbanned": "Entsperrt",
  "user.deleted": "Konto gelöscht",
  "user.password_set": "Passwort gesetzt",
  "user.password_reset_requested": "Passwort-Reset gesendet",
  "session.revoked": "Sitzung beendet",
  "session.revoked_all": "Alle Sitzungen beendet",
  "impersonation.started": "Übernahme gestartet",
  "impersonation.ended": "Übernahme beendet",
} as const;

const DAY_SECONDS = 24 * 60 * 60;

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Turns an entry's `metadata` into one readable line, or null when the action
 * carries nothing worth spelling out. Written defensively: the column is JSON,
 * and rows written by an older version must not break the page.
 */
export function describeAuditMetadata(action: string, metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const data = metadata as Record<string, unknown>;

  if (action === "user.banned") {
    const reason = readString(data, "banReason") ?? "kein Grund angegeben";
    const seconds = data.banExpiresIn;
    const duration =
      typeof seconds === "number" && seconds > 0
        ? `${Math.round(seconds / DAY_SECONDS)} Tage`
        : "unbefristet";
    return `${reason} · ${duration}`;
  }

  if (action === "user.role_changed") {
    const role = readString(data, "role");
    return role ? `Neue Rolle: ${role === "admin" ? "Instanz-Admin" : role}` : null;
  }

  if (action === "impersonation.started") {
    const expiresAt = readString(data, "expiresAt");
    return expiresAt ? `Läuft ab am ${formatDateTime(expiresAt)}` : null;
  }

  if (action === "impersonation.ended") {
    const startedAt = readString(data, "impersonationStartedAt");
    return startedAt ? `Begonnen am ${formatDateTime(startedAt)}` : null;
  }

  return null;
}
