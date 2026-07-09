import { describe, expect, it } from "vitest";

import { extractHeadings } from "@/components/editor/headings";

const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

describe("extractHeadings", () => {
  it("returns positional ids in document order with level and text", () => {
    const doc = {
      type: "doc",
      content: [
        heading(1, "Intro"),
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
        heading(2, "Details"),
        heading(3, "Edge cases"),
      ],
    };
    expect(extractHeadings(doc)).toEqual([
      { id: "heading-0", level: 1, text: "Intro" },
      { id: "heading-1", level: 2, text: "Details" },
      { id: "heading-2", level: 3, text: "Edge cases" },
    ]);
  });

  it("keeps empty headings in the index so ids stay aligned with the DOM", () => {
    const doc = {
      type: "doc",
      content: [heading(1, ""), heading(2, "Real")],
    };
    // The empty heading still consumes heading-0, so the real one is heading-1
    // (matching the id injected into the rendered HTML).
    expect(extractHeadings(doc)).toEqual([
      { id: "heading-0", level: 1, text: "" },
      { id: "heading-1", level: 2, text: "Real" },
    ]);
  });

  it("concatenates rich inline children", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    expect(extractHeadings(doc)[0]?.text).toBe("Hello world");
  });

  it("returns nothing for non-document input", () => {
    expect(extractHeadings(null)).toEqual([]);
    expect(extractHeadings("x")).toEqual([]);
  });
});
