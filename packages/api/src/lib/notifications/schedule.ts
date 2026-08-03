import type { DigestPreferences } from "./settings";

/**
 * Turning a recipient's schedule ("weekly, Monday, 08:00, Europe/Berlin") into
 * the next UTC instant it fires at.
 *
 * Everything here is pure and DB-free so the DST behaviour is unit-testable
 * without a database. The one hard rule: never do arithmetic on UTC
 * milliseconds and hope it lands on the right local hour. A digest scheduled
 * for 08:00 must arrive at 08:00 on both sides of a DST switch, so the
 * calculation walks *civil* dates and converts to an instant only at the end,
 * asking the runtime's IANA database (via `Intl`) for the offset that actually
 * applies on that date.
 */

/** A local (wall-clock) date and time — no offset attached. */
export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/** True when the runtime's IANA database knows this zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Falls back to UTC for a zone this runtime does not know. A stored zone can
 * become invalid (a renamed zone, a hand-edited row) and a digest that throws
 * would block every other recipient in the same run.
 */
export function safeTimeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : "UTC";
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function toWallClock(timeZone: string, instant: Date): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/** Milliseconds `timeZone` is ahead of UTC at `instant`. */
function offsetAt(timeZone: string, instant: Date): number {
  const local = toWallClock(timeZone, instant);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // `instant`'s own seconds/ms are irrelevant to the offset; drop them on both
  // sides so the difference is exactly the zone offset.
  const truncated = Math.floor(instant.getTime() / 60000) * 60000;
  return asUtc - truncated;
}

/**
 * The instant at which `wall` is the local reading in `timeZone`.
 *
 * Resolved twice: the first guess uses the offset in force at the *UTC*
 * interpretation of the wall clock, which is wrong within a few hours of a DST
 * switch; re-reading the offset at the resulting instant corrects it.
 *
 * Two local times are unrepresentable-or-doubled around a switch. A wall clock
 * inside a spring-forward gap resolves to the instant just after the jump; an
 * ambiguous autumn hour resolves to one of its two instants. Both are fine for
 * a digest — it is a daily-ish mail, not a calendar invite.
 */
export function instantFromWallClock(timeZone: string, wall: WallClock): Date {
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstOffset = offsetAt(timeZone, new Date(utcGuess));
  const secondOffset = offsetAt(timeZone, new Date(utcGuess - firstOffset));
  return new Date(utcGuess - secondOffset);
}

type CivilDate = { year: number; month: number; day: number };

/** Day of week of a civil date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Day-of-month is capped at 28 so no month is ever skipped (February). */
export const MAX_DAY_OF_MONTH = 28;

// A monthly schedule needs at most ~31 days of lookahead; the bound is generous
// so a future frequency cannot silently loop forever.
const MAX_LOOKAHEAD_DAYS = 400;

/**
 * The next instant this schedule fires, strictly after `from`. Null when the
 * recipient's frequency is `off` — the caller stores that as "not due".
 */
export function computeNextRun(preferences: DigestPreferences, from: Date): Date | null {
  if (preferences.frequency === "off") return null;

  const timeZone = safeTimeZone(preferences.timezone);
  const hour = clamp(preferences.hour, 0, 23);
  const weekday = clamp(preferences.weekday, 0, 6);
  const dayOfMonth = clamp(preferences.dayOfMonth, 1, MAX_DAY_OF_MONTH);
  const start = toWallClock(timeZone, from);

  for (let offset = 0; offset < MAX_LOOKAHEAD_DAYS; offset++) {
    const date = addDays({ year: start.year, month: start.month, day: start.day }, offset);
    const matches =
      preferences.frequency === "daily" ||
      (preferences.frequency === "weekly" && weekdayOf(date) === weekday) ||
      (preferences.frequency === "monthly" && date.day === dayOfMonth);
    if (!matches) continue;
    const candidate = instantFromWallClock(timeZone, { ...date, hour, minute: 0 });
    // Strictly after: re-running the scheduler in the same minute a digest was
    // sent must not schedule that same instant again.
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  return null;
}
