import { describe, expect, it } from "vitest";

import { formatRemaining, graceDeadline, isUrgent } from "@/lib/two-factor";

const now = new Date("2026-08-04T10:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);
const inHours = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe("formatRemaining", () => {
  it("counts in whole days while more than one is left", () => {
    expect(formatRemaining(inDays(6), now)).toBe("noch 6 Tage");
    expect(formatRemaining(inDays(1), now)).toBe("noch 1 Tag");
  });

  it("falls back to hours and then minutes as the deadline nears", () => {
    expect(formatRemaining(inHours(5), now)).toBe("noch 5 Stunden");
    expect(formatRemaining(inHours(1), now)).toBe("noch 1 Stunde");
    expect(formatRemaining(new Date(now.getTime() + 90_000), now)).toBe("noch 2 Minuten");
  });

  it("never rounds down to zero while time remains", () => {
    expect(formatRemaining(new Date(now.getTime() + 1_000), now)).toBe("noch 1 Minute");
  });

  it("reports a passed deadline rather than a negative countdown", () => {
    expect(formatRemaining(inHours(-1), now)).toBe("abgelaufen");
    expect(formatRemaining(now, now)).toBe("abgelaufen");
  });
});

describe("isUrgent", () => {
  it("turns urgent inside the last day", () => {
    expect(isUrgent(inDays(2), now)).toBe(false);
    expect(isUrgent(inHours(23), now)).toBe(true);
    expect(isUrgent(inHours(-1), now)).toBe(true);
  });
});

describe("graceDeadline", () => {
  it("maps a preset to an absolute instant", () => {
    expect(graceDeadline(7, now)).toEqual(inDays(7));
  });

  it("treats the 'immediately' preset as no deadline at all", () => {
    expect(graceDeadline(null, now)).toBeNull();
  });
});
