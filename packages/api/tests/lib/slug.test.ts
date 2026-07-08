import { describe, expect, it } from "vitest";

import { slugify, uniqueSlug } from "../../src/lib/slug";

describe("slugify", () => {
  it("lowercases and dash-separates words", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips diacritics to their ASCII base", () => {
    expect(slugify("Über Café Motörhead")).toBe("uber-cafe-motorhead");
  });

  it("collapses punctuation and trims leading/trailing dashes", () => {
    expect(slugify("  --Foo & Bar!!  ")).toBe("foo-bar");
  });

  it("falls back when the input reduces to nothing", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("###", "page")).toBe("page");
  });

  it("caps length at 80 characters", () => {
    expect(slugify("a".repeat(200)).length).toBe(80);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", async () => {
    expect(await uniqueSlug("intro", async () => false)).toBe("intro");
  });

  it("appends an incrementing suffix past taken candidates", async () => {
    const taken = new Set(["intro", "intro-2", "intro-3"]);
    expect(await uniqueSlug("intro", async (c) => taken.has(c))).toBe("intro-4");
  });

  it("stops at the first free suffix", async () => {
    const taken = new Set(["intro"]);
    expect(await uniqueSlug("intro", async (c) => taken.has(c))).toBe("intro-2");
  });
});
