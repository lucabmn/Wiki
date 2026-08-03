import { describe, expect, it } from "vitest";

import {
  computeNextRun,
  instantFromWallClock,
  safeTimeZone,
  toWallClock,
} from "../../src/lib/notifications/schedule";
import {
  ORGANIZATION_DIGEST_DEFAULTS,
  resolveDigestPreferences,
  actionsForCategories,
  categoryForAction,
  type DigestPreferences,
  type UserDigestOverride,
} from "../../src/lib/notifications/settings";

const base: DigestPreferences = {
  frequency: "daily",
  hour: 8,
  weekday: 1,
  dayOfMonth: 1,
  timezone: "Europe/Berlin",
  categories: ["pages_created"],
  scope: "organization",
  skipIfEmpty: true,
  includeOwnActivity: false,
};

/** The local reading of an instant, as "YYYY-MM-DD HH:mm" — what a user sees. */
function localOf(instant: Date, timeZone: string): string {
  const wall = toWallClock(timeZone, instant);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`;
}

describe("computeNextRun — daily", () => {
  it("picks today's slot when it is still ahead", () => {
    const from = new Date("2026-03-10T05:00:00Z"); // 06:00 Berlin (CET)
    const next = computeNextRun(base, from)!;
    expect(localOf(next, "Europe/Berlin")).toBe("2026-03-10 08:00");
  });

  it("rolls over to tomorrow once today's slot has passed", () => {
    const from = new Date("2026-03-10T09:00:00Z"); // 10:00 Berlin
    const next = computeNextRun(base, from)!;
    expect(localOf(next, "Europe/Berlin")).toBe("2026-03-11 08:00");
  });

  it("never returns the instant it was given", () => {
    const from = new Date("2026-03-10T07:00:00Z"); // exactly 08:00 Berlin
    const next = computeNextRun(base, from)!;
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(localOf(next, "Europe/Berlin")).toBe("2026-03-11 08:00");
  });

  it("returns null when the schedule is off", () => {
    expect(computeNextRun({ ...base, frequency: "off" }, new Date())).toBeNull();
  });
});

/**
 * The reason this module exists. Naive "+24h" arithmetic drifts by an hour
 * across a DST switch, so a digest scheduled for 08:00 would start arriving at
 * 07:00 or 09:00 and stay there.
 */
describe("computeNextRun — daylight saving time", () => {
  it("keeps the local hour across the spring-forward switch (Europe/Berlin)", () => {
    // The clocks jump at 02:00 local on 2026-03-29, so that day's 08:00 slot is
    // already CEST (UTC+2) while the day before is still CET (UTC+1) — the two
    // UTC instants are 23 hours apart, not 24.
    const before = computeNextRun(base, new Date("2026-03-27T09:00:00Z"))!;
    expect(before.toISOString()).toBe("2026-03-28T07:00:00.000Z");
    expect(localOf(before, "Europe/Berlin")).toBe("2026-03-28 08:00");

    const after = computeNextRun(base, before)!;
    expect(after.toISOString()).toBe("2026-03-29T06:00:00.000Z");
    expect(localOf(after, "Europe/Berlin")).toBe("2026-03-29 08:00");

    expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("keeps the local hour across the autumn fall-back switch", () => {
    // 2026-10-25 is the CEST -> CET switch; that day is 25 hours long.
    const before = computeNextRun(base, new Date("2026-10-24T09:00:00Z"))!;
    expect(localOf(before, "Europe/Berlin")).toBe("2026-10-25 08:00");

    const after = computeNextRun(base, before)!;
    expect(localOf(after, "Europe/Berlin")).toBe("2026-10-26 08:00");
    expect(after.getTime() - before.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("resolves a wall clock inside the spring-forward gap to a real instant", () => {
    // 02:30 local does not exist on 2026-03-29 in Berlin.
    const resolved = instantFromWallClock("Europe/Berlin", {
      year: 2026,
      month: 3,
      day: 29,
      hour: 2,
      minute: 30,
    });
    expect(Number.isNaN(resolved.getTime())).toBe(false);
    expect(localOf(resolved, "Europe/Berlin")).toBe("2026-03-29 03:30");
  });
});

describe("computeNextRun — weekly and monthly", () => {
  it("lands on the configured weekday", () => {
    // 2026-03-10 is a Tuesday; the next Monday is the 16th.
    const next = computeNextRun(
      { ...base, frequency: "weekly", weekday: 1 },
      new Date("2026-03-10T09:00:00Z"),
    )!;
    expect(localOf(next, "Europe/Berlin")).toBe("2026-03-16 08:00");
  });

  it("stays on the same day when it is still ahead", () => {
    // 2026-03-16 is a Monday, 06:00 local — the 08:00 slot has not passed.
    const next = computeNextRun(
      { ...base, frequency: "weekly", weekday: 1 },
      new Date("2026-03-16T05:00:00Z"),
    )!;
    expect(localOf(next, "Europe/Berlin")).toBe("2026-03-16 08:00");
  });

  it("lands on the configured day of month, including across February", () => {
    const next = computeNextRun(
      { ...base, frequency: "monthly", dayOfMonth: 28 },
      new Date("2027-01-29T09:00:00Z"),
    )!;
    expect(localOf(next, "Europe/Berlin")).toBe("2027-02-28 08:00");
  });

  it("caps an out-of-range day of month instead of never firing", () => {
    const next = computeNextRun(
      { ...base, frequency: "monthly", dayOfMonth: 31 },
      new Date("2026-03-10T09:00:00Z"),
    )!;
    expect(localOf(next, "Europe/Berlin")).toBe("2026-03-28 08:00");
  });
});

describe("safeTimeZone", () => {
  it("keeps a zone the runtime knows", () => {
    expect(safeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("falls back to UTC rather than throwing on an unknown zone", () => {
    expect(safeTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    // …and the scheduler still produces a run instead of blowing up the batch.
    expect(computeNextRun({ ...base, timezone: "Mars/Olympus_Mons" }, new Date())).not.toBeNull();
  });
});

describe("resolveDigestPreferences", () => {
  const organization = {
    ...ORGANIZATION_DIGEST_DEFAULTS,
    frequency: "weekly" as const,
    hour: 9,
    timezone: "Europe/Berlin",
  };

  it("uses the organization defaults when the user has no row", () => {
    expect(resolveDigestPreferences(organization, null)).toMatchObject({
      frequency: "weekly",
      hour: 9,
    });
  });

  it("uses the organization defaults for a row still set to inherit", () => {
    const override: UserDigestOverride = {
      mode: "inherit",
      frequency: "daily",
      hour: 6,
      weekday: null,
      dayOfMonth: null,
      timezone: null,
      categories: null,
      scope: null,
      skipIfEmpty: null,
      includeOwnActivity: null,
    };
    expect(resolveDigestPreferences(organization, override)).toMatchObject({
      frequency: "weekly",
      hour: 9,
    });
  });

  it("lets a custom row override field by field, inheriting the rest", () => {
    const override: UserDigestOverride = {
      mode: "custom",
      frequency: "daily",
      hour: null,
      weekday: null,
      dayOfMonth: null,
      timezone: null,
      categories: null,
      scope: null,
      skipIfEmpty: null,
      includeOwnActivity: null,
    };
    const resolved = resolveDigestPreferences(organization, override);
    expect(resolved.frequency).toBe("daily");
    // Untouched fields still follow the admin, including later changes to them.
    expect(resolved.hour).toBe(9);
    expect(resolved.timezone).toBe("Europe/Berlin");
  });

  it("ignores a custom row once the admin locks overrides", () => {
    const override: UserDigestOverride = {
      mode: "custom",
      frequency: "off",
      hour: 23,
      weekday: null,
      dayOfMonth: null,
      timezone: null,
      categories: null,
      scope: null,
      skipIfEmpty: null,
      includeOwnActivity: null,
    };
    const locked = { ...organization, allowUserOverride: false };
    expect(resolveDigestPreferences(locked, override)).toMatchObject({
      frequency: "weekly",
      hour: 9,
    });
  });
});

describe("category mapping", () => {
  it("expands categories into the actions they cover, without duplicates", () => {
    const actions = actionsForCategories(["pages_created", "pages_updated", "pages_created"]);
    expect(actions).toContain("page.created");
    expect(actions).toContain("page.published");
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("maps every action back to exactly one category", () => {
    expect(categoryForAction("page.created")).toBe("pages_created");
    expect(categoryForAction("page.archived")).toBe("pages_removed");
    expect(categoryForAction("comment.resolved")).toBe("comments");
    expect(categoryForAction("space.deleted")).toBe("spaces");
  });

  it("selects nothing when no category is chosen", () => {
    expect(actionsForCategories([])).toEqual([]);
  });
});
