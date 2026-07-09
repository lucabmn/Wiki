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

/** A text node carrying a single link mark with the given href. */
function linkText(text: string, href: string) {
  return { type: "text", text, marks: [{ type: "link", attrs: { href } }] };
}

describe("extractPageLinks", () => {
  it("returns no links for non-document input", () => {
    expect(extractPageLinks(null)).toEqual([]);
    expect(extractPageLinks(undefined)).toEqual([]);
    expect(extractPageLinks("anything")).toEqual([]);
    expect(extractPageLinks(42)).toEqual([]);
    expect(extractPageLinks({ type: "doc", content: [] })).toEqual([]);
  });

  it("collects the target id of internal /pages/<id> link marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "see " }, linkText("that page", "/pages/page-123")],
        },
      ],
    };
    expect(extractPageLinks(doc)).toEqual(["page-123"]);
  });

  it("walks nested content (lists, blockquotes) for links", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [linkText("a", "/pages/a")] },
                { type: "paragraph", content: [linkText("b", "/pages/b")] },
              ],
            },
          ],
        },
      ],
    };
    expect(extractPageLinks(doc)).toEqual(["a", "b"]);
  });

  it("ignores external links and non-page hrefs", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            linkText("external", "https://example.com/pages/x"),
            linkText("deep", "/pages/a/edit"),
            linkText("query", "/pages/a?tab=x"),
            linkText("internal", "/pages/keep-me"),
          ],
        },
      ],
    };
    expect(extractPageLinks(doc)).toEqual(["keep-me"]);
  });

  it("preserves order and keeps duplicates (deduped downstream)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            linkText("1", "/pages/a"),
            linkText("2", "/pages/a"),
            linkText("3", "/pages/b"),
          ],
        },
      ],
    };
    expect(extractPageLinks(doc)).toEqual(["a", "a", "b"]);
  });
});
