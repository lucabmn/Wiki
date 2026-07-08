import { describe, expect, it } from "vitest";

import { extractPageLinks, normalizeLinkTargets } from "../../src/lib/page-links";

describe("normalizeLinkTargets", () => {
  it("de-duplicates target ids", () => {
    expect(normalizeLinkTargets("src", ["a", "a", "b", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("drops self-references", () => {
    expect(normalizeLinkTargets("src", ["a", "src", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty array for no targets", () => {
    expect(normalizeLinkTargets("src", [])).toEqual([]);
  });

  it("preserves first-seen order", () => {
    expect(normalizeLinkTargets("src", ["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
});

describe("extractPageLinks (stub until the editor exists)", () => {
  it("returns no links for any content", () => {
    expect(extractPageLinks(null)).toEqual([]);
    expect(extractPageLinks({ type: "doc", content: [] })).toEqual([]);
    expect(extractPageLinks("anything")).toEqual([]);
  });
});
