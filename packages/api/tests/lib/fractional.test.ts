import { describe, expect, it } from "vitest";

import { generateKeyBetween } from "../../src/lib/fractional";

describe("generateKeyBetween", () => {
  it("seeds an empty list with 'a0' (matches the db position default)", () => {
    expect(generateKeyBetween(null, null)).toBe("a0");
  });

  it("keeps appended keys strictly increasing", () => {
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 500; i++) {
      last = generateKeyBetween(last, null);
      keys.push(last);
    }
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1]! < keys[i]!).toBe(true);
    }
  });

  it("keeps prepended keys strictly decreasing", () => {
    const keys: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 500; i++) {
      first = generateKeyBetween(null, first);
      keys.push(first);
    }
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1]! > keys[i]!).toBe(true);
    }
  });

  it("always lands strictly between two fixed neighbours, repeatedly", () => {
    const a = "a0";
    let b = "a1";
    for (let i = 0; i < 200; i++) {
      const mid = generateKeyBetween(a, b);
      expect(a < mid).toBe(true);
      expect(mid < b).toBe(true);
      b = mid; // squeeze toward `a` — exercises the fractional-suffix path
    }
  });

  it("produces a key between two arbitrary generated neighbours", () => {
    // Build an ordered list, then insert between every adjacent pair.
    const list: string[] = [];
    let cur: string | null = null;
    for (let i = 0; i < 20; i++) {
      cur = generateKeyBetween(cur, null);
      list.push(cur);
    }
    for (let i = 0; i < list.length - 1; i++) {
      const mid = generateKeyBetween(list[i]!, list[i + 1]!);
      expect(list[i]! < mid).toBe(true);
      expect(mid < list[i + 1]!).toBe(true);
    }
  });

  it("throws when the lower bound is not strictly less than the upper", () => {
    expect(() => generateKeyBetween("a1", "a0")).toThrow();
    expect(() => generateKeyBetween("a0", "a0")).toThrow();
  });
});
