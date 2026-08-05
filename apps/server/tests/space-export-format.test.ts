import { describe, expect, it } from "vitest";

import {
  documentToHtml,
  normalizeDocument,
  rewriteDocumentUrls,
  safeArchiveName,
} from "../src/space-export-format";
import { documentToMarkdown } from "../src/space-export-markdown";

const document = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello ", marks: [{ type: "bold" }] },
        {
          type: "text",
          text: "wiki",
          marks: [{ type: "link", attrs: { href: "/pages/p2" } }],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
        },
      ],
    },
    { type: "image", attrs: { src: "/attachments/a1/inline", alt: "<diagram>" } },
  ],
};

describe("Space export formatting", () => {
  it("creates safe, bounded archive path segments", () => {
    expect(safeArchiveName("../../Überblick / Q1")).toBe("Uberblick-Q1");
    expect(safeArchiveName("...")).toBe("item");
    expect(safeArchiveName("x".repeat(150))).toHaveLength(100);
    expect(safeArchiveName("CON.txt")).toBe("_CON.txt");
  });

  it("rewrites nested rich-text URLs without mutating the source", () => {
    const rewritten = rewriteDocumentUrls(document, (url) => `archive:${url}`);
    expect(JSON.stringify(rewritten)).toContain("archive:/pages/p2");
    expect(JSON.stringify(rewritten)).toContain("archive:/attachments/a1/inline");
    expect(JSON.stringify(document)).not.toContain("archive:");
  });

  it("serializes portable Markdown including ordered lists", () => {
    const markdown = documentToMarkdown(document, "Guide");
    expect(markdown).toContain("# Guide");
    expect(markdown).toContain("**Hello **[wiki](/pages/p2)");
    expect(markdown).toContain("3. A\n4. B");
    expect(markdown).toContain("![\\<diagram\\>](/attachments/a1/inline)");
  });

  it("serializes escaped standalone HTML", () => {
    const html = documentToHtml(document, "<Guide>");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("<title>&lt;Guide&gt;</title>");
    expect(html).toContain('<a href="/pages/p2" rel="noopener noreferrer">wiki</a>');
    expect(html).toContain('alt="&lt;diagram&gt;"');
  });

  it("blocks active URL schemes and preserves underline", () => {
    const html = documentToHtml(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "unsafe",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                  { type: "underline" },
                ],
              },
            ],
          },
        ],
      },
      "Safety",
    );
    expect(html).toContain('<a href="#"');
    expect(html).toContain("<u>");
    expect(html).not.toContain("javascript:");
  });

  it("falls back to plain text for malformed persisted documents", () => {
    const normalized = normalizeDocument({ type: "doc", content: "broken" }, "Recovered text");
    expect(normalized.warnings).toHaveLength(1);
    expect(documentToMarkdown(normalized.content, "Recovered")).toContain("Recovered text");
  });
});
