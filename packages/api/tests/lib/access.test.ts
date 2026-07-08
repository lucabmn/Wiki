import { describe, expect, it } from "vitest";

import { resolveSpaceAccess } from "../../src/lib/access";

describe("resolveSpaceAccess", () => {
  const cases: Array<{
    visibility: "public" | "private" | "restricted";
    isMember: boolean;
    isCreator: boolean;
    expected: boolean;
  }> = [
    // public: anyone in the org, regardless of membership/creator
    { visibility: "public", isMember: false, isCreator: false, expected: true },
    { visibility: "public", isMember: false, isCreator: true, expected: true },
    { visibility: "public", isMember: true, isCreator: false, expected: true },
    { visibility: "public", isMember: true, isCreator: true, expected: true },
    // private: explicit members only — creator has no implicit access
    { visibility: "private", isMember: false, isCreator: false, expected: false },
    { visibility: "private", isMember: false, isCreator: true, expected: false },
    { visibility: "private", isMember: true, isCreator: false, expected: true },
    { visibility: "private", isMember: true, isCreator: true, expected: true },
    // restricted: creator OR explicit member
    { visibility: "restricted", isMember: false, isCreator: false, expected: false },
    { visibility: "restricted", isMember: false, isCreator: true, expected: true },
    { visibility: "restricted", isMember: true, isCreator: false, expected: true },
    { visibility: "restricted", isMember: true, isCreator: true, expected: true },
  ];

  for (const c of cases) {
    it(`${c.visibility} member=${c.isMember} creator=${c.isCreator} -> ${c.expected}`, () => {
      expect(resolveSpaceAccess(c.visibility, c.isMember, c.isCreator)).toBe(c.expected);
    });
  }

  it("covers the full 3x2x2 truth table", () => {
    expect(cases).toHaveLength(12);
  });
});
