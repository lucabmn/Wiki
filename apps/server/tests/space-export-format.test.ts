import { adoptMermaidCodeBlocks, MERMAID_NODE_NAME } from "@nilovon-wiki/editor/mermaid-document";
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

const diagramDocument = {
  type: "doc",
  content: [
    {
      type: MERMAID_NODE_NAME,
      attrs: { source: "flowchart TD\n  A[Start] --> B[Ende]", caption: "Freigabeprozess" },
    },
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

  it("exports a diagram as a ```mermaid block", () => {
    const markdown = documentToMarkdown(diagramDocument, "Prozess");

    expect(markdown).toContain("```mermaid\nflowchart TD\n  A[Start] --> B[Ende]\n```");
    expect(markdown).toContain("_Freigabeprozess_");
  });

  it("lengthens the fence when the source contains backticks", () => {
    const markdown = documentToMarkdown(
      { type: "doc", content: [{ type: MERMAID_NODE_NAME, attrs: { source: "a ``` b" } }] },
      "Prozess",
    );

    expect(markdown).toContain("````mermaid\na ``` b\n````");
  });

  it('exports a diagram as a <pre class="mermaid"> block plus a note', () => {
    const html = documentToHtml(diagramDocument, "Prozess");

    expect(html).toContain('<pre class="mermaid">flowchart TD\n  A[Start] --&gt; B[Ende]</pre>');
    expect(html).toContain("<figcaption>Freigabeprozess</figcaption>");
    expect(html).toContain("nicht gezeichnet");
    // No note on a page without diagrams.
    expect(documentToHtml(document, "Guide")).not.toContain("nicht gezeichnet");
  });

  it("escapes a diagram source instead of emitting it as markup", () => {
    const html = documentToHtml(
      {
        type: "doc",
        content: [
          {
            type: MERMAID_NODE_NAME,
            attrs: { source: "<script>alert(1)</script>", caption: null },
          },
        ],
      },
      "Prozess",
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("imports a ```mermaid block back into a diagram node", () => {
    // The shape every Markdown/HTML importer produces for a fence.
    const imported = adoptMermaidCodeBlocks({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "flowchart TD\n  A[Start] --> B[Ende]" }],
        },
      ],
    });

    expect(imported).toEqual({
      type: "doc",
      content: [
        {
          type: MERMAID_NODE_NAME,
          attrs: { source: "flowchart TD\n  A[Start] --> B[Ende]", caption: null },
        },
      ],
    });
    // …and it exports to the same fence again: the round trip closes.
    expect(documentToMarkdown(imported, "Prozess")).toContain("```mermaid");
  });

  it("falls back to plain text for malformed persisted documents", () => {
    const normalized = normalizeDocument({ type: "doc", content: "broken" }, "Recovered text");
    expect(normalized.warnings).toHaveLength(1);
    expect(documentToMarkdown(normalized.content, "Recovered")).toContain("Recovered text");
  });
});
