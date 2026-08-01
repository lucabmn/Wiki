/** Date + time in German notation, e.g. "31.07.2026, 14:05". */
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Date only in German notation, e.g. "31. Juli 2026". */
export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}

const relativeTime = new Intl.RelativeTimeFormat("de", { numeric: "auto" });

/** Coarse relative distance to now, e.g. "vor 3 Stunden". Days is the largest unit. */
export function timeAgo(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(seconds) >= secs) {
      return relativeTime.format(Math.round(seconds / secs), unit);
    }
  }
  return relativeTime.format(0, "minute");
}

/** Up to two uppercase initials from a display name, e.g. "Luca Braun" → "LB". */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
