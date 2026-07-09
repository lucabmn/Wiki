import { describe, expect, it } from "vitest";

import { resolveSpaceAccess, resolveSpaceRole, roleAllows } from "../../src/lib/access";

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

describe("resolveSpaceRole", () => {
  it("returns null whenever read is denied (mirrors resolveSpaceAccess)", () => {
    // private non-member, restricted non-member/non-creator — no read, no role
    expect(resolveSpaceRole("private", null, false, false)).toBeNull();
    expect(resolveSpaceRole("restricted", null, false, false)).toBeNull();
    // even an org manager can't reach a private space they aren't a member of
    expect(resolveSpaceRole("private", null, false, true)).toBeNull();
  });

  it("grants a viewer baseline on public spaces to non-members", () => {
    expect(resolveSpaceRole("public", null, false, false)).toBe("viewer");
  });

  it("returns the membership role when present", () => {
    expect(resolveSpaceRole("private", "editor", false, false)).toBe("editor");
    expect(resolveSpaceRole("private", "commenter", false, false)).toBe("commenter");
    expect(resolveSpaceRole("public", "editor", false, false)).toBe("editor");
    // membership beats the public viewer baseline
    expect(resolveSpaceRole("public", "admin", false, false)).toBe("admin");
  });

  it("elevates creators and org managers to admin on readable spaces", () => {
    expect(resolveSpaceRole("restricted", null, true, false)).toBe("admin");
    expect(resolveSpaceRole("private", "viewer", false, true)).toBe("admin");
    expect(resolveSpaceRole("public", null, false, true)).toBe("admin");
  });
});

describe("roleAllows", () => {
  it("maps roles to capabilities by rank", () => {
    expect(roleAllows(null, "read")).toBe(false);
    expect(roleAllows("viewer", "read")).toBe(true);
    expect(roleAllows("viewer", "comment")).toBe(false);
    expect(roleAllows("commenter", "comment")).toBe(true);
    expect(roleAllows("commenter", "write")).toBe(false);
    expect(roleAllows("editor", "write")).toBe(true);
    expect(roleAllows("editor", "manage")).toBe(false);
    expect(roleAllows("admin", "manage")).toBe(true);
  });
});
