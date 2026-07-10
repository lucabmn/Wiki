import { describe, expect, it } from "vitest";

import { splitRoles } from "@/lib/roles";
import { splitSnippet } from "@/lib/snippet";

describe("splitRoles", () => {
  it("splits, trims, and drops blanks", () => {
    expect(splitRoles("owner, admin ,, member")).toEqual(["owner", "admin", "member"]);
  });

  it("treats null/undefined/empty as no roles", () => {
    expect(splitRoles(null)).toEqual([]);
    expect(splitRoles(undefined)).toEqual([]);
    expect(splitRoles("")).toEqual([]);
  });
});

describe("splitSnippet", () => {
  it("flags <b>-wrapped terms as matches, keeps surrounding text plain", () => {
    expect(splitSnippet("see the <b>roadmap</b> here")).toEqual([
      { value: "see the ", match: false },
      { value: "roadmap", match: true },
      { value: " here", match: false },
    ]);
  });

  it("returns a single non-match part when there are no markers", () => {
    expect(splitSnippet("plain text")).toEqual([{ value: "plain text", match: false }]);
  });
});
