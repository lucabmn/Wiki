/** Shared, side-effect-free helpers for the two-factor policy UI. */

/** Where a user goes to gain a second factor. Also the one route the gate lets through. */
export const SECURITY_SETTINGS_PATH = "/settings/security";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Coarse, reassuring countdown to a deadline — "noch 6 Tage", "noch 3 Stunden".
 *
 * Only the largest meaningful unit is shown: a banner that ticks down the
 * seconds reads as an emergency for six days straight, which is exactly how a
 * grace period stops being taken seriously.
 */
export function formatRemaining(until: Date, now: Date = new Date()): string {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return "abgelaufen";
  if (ms >= DAY) {
    const days = Math.ceil(ms / DAY);
    return `noch ${days} ${days === 1 ? "Tag" : "Tage"}`;
  }
  if (ms >= HOUR) {
    const hours = Math.ceil(ms / HOUR);
    return `noch ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  }
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return `noch ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
}

/**
 * Whether the deadline is close enough to warrant the alarming treatment.
 * Below a day the banner stops being dismissible and turns destructive.
 */
export function isUrgent(until: Date, now: Date = new Date()): boolean {
  return until.getTime() - now.getTime() < DAY;
}

/** Presets the admin picks a deadline from, in days. `null` = effective now. */
export const GRACE_PRESETS: { label: string; days: number | null }[] = [
  { label: "Sofort", days: null },
  { label: "7 Tage", days: 7 },
  { label: "14 Tage", days: 14 },
  { label: "30 Tage", days: 30 },
];

/** The deadline `days` from `now`, or null for "no grace period". */
export function graceDeadline(days: number | null, now: Date = new Date()): Date | null {
  if (days === null) return null;
  return new Date(now.getTime() + days * DAY);
}
