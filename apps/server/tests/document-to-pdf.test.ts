import { describe, expect, it } from "vitest";

import { documentToPdf, imageSources, placeholderPdf } from "../src/pdf/document-to-pdf";
import { isPdf, pdfEmbedsImage, pdfLinksTo, pdfPageCount, pngFixture } from "./helpers/pdf";

const meta = {
  title: "Notfallhandbuch",
  spaceName: "Handbuch",
  exportedAt: new Date("2026-01-02T10:00:00Z"),
};

function text(value: string, marks?: unknown[]) {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

const richDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Überschrift mit Umlauten äöüß")] },
    {
      type: "paragraph",
      content: [
        text("Ein "),
        text("fetter", [{ type: "bold" }]),
        text(" und ein "),
        text("verlinkter", [{ type: "link", attrs: { href: "/pages/p2" } }]),
        text(" Lauf."),
      ],
    },
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("Punkt")] }] }],
    },
    { type: "codeBlock", content: [text("const x = 1;\nconst y = 2;")] },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [text("Feld")] }] },
            { type: "tableHeader", content: [{ type: "paragraph", content: [text("Wert")] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [text("a")] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [text("b")] }] },
          ],
        },
      ],
    },
    { type: "image", attrs: { src: "/attachments/a1/inline", alt: "Diagramm" } },
  ],
};

describe("documentToPdf", () => {
  it("produces a valid, non-empty PDF from a rich document", async () => {
    const bytes = await documentToPdf(richDocument, meta);
    expect(isPdf(bytes)).toBe(true);
    expect(pdfPageCount(bytes)).toBeGreaterThan(0);
  });

  it("embeds image bytes instead of referencing the object store", async () => {
    const withoutImage = await documentToPdf(richDocument, meta);
    const withImage = await documentToPdf(richDocument, meta, {
      loadImage: async (source) =>
        source === "/attachments/a1/inline" ? pngFixture(64, 64) : null,
    });

    expect(pdfEmbedsImage(withoutImage)).toBe(false);
    expect(pdfEmbedsImage(withImage)).toBe(true);
    expect(withImage.length).toBeGreaterThan(withoutImage.length);
  });

  it("keeps rendering when a single image cannot be loaded", async () => {
    const bytes = await documentToPdf(richDocument, meta, {
      loadImage: async () => {
        throw new Error("object store unreachable");
      },
    });
    expect(isPdf(bytes)).toBe(true);
  });

  it("writes resolved link targets into the document", async () => {
    const bytes = await documentToPdf(richDocument, meta, {
      resolveLink: (url) => `https://wiki.test${url}`,
    });
    expect(pdfLinksTo(bytes, "https://wiki.test/pages/p2")).toBe(true);
  });

  it("stops at the node budget and says so in the document", async () => {
    const huge = {
      type: "doc",
      content: Array.from({ length: 400 }, () => ({
        type: "paragraph",
        content: [text("Absatz")],
      })),
    };
    const bounded = await documentToPdf(huge, meta, { maxNodes: 10 });
    const complete = await documentToPdf(huge, meta);
    expect(pdfPageCount(bounded)).toBe(1);
    expect(pdfPageCount(complete)).toBeGreaterThan(1);
  });

  it("gives up on image loading once the deadline has passed", async () => {
    await expect(
      documentToPdf(richDocument, meta, {
        timeoutMs: 1,
        loadImage: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return pngFixture();
        },
      }),
    ).rejects.toThrow(/exceeded/);
  });

  it("collects every distinct image source once", () => {
    expect(imageSources(richDocument as never)).toEqual(["/attachments/a1/inline"]);
  });

  it("prints a diagram as its source instead of dropping it", async () => {
    // The diagram node is an atom: without an explicit case the block renderer
    // would skip it and the PDF would lose the diagram without a trace.
    const diagram = {
      type: "doc",
      content: [
        {
          type: "mermaidDiagram",
          attrs: { source: "flowchart TD\n  A[Start] --> B[Ende]", caption: "Freigabe" },
        },
      ],
    };
    const withDiagram = await documentToPdf(diagram, meta);
    const empty = await documentToPdf({ type: "doc", content: [] }, meta);

    expect(isPdf(withDiagram)).toBe(true);
    expect(pdfPageCount(withDiagram)).toBe(1);
    expect(withDiagram.length).toBeGreaterThan(empty.length);
  });

  it("renders a single-page placeholder carrying the reason", async () => {
    const bytes = await placeholderPdf(meta, "Obergrenze erreicht.");
    expect(isPdf(bytes)).toBe(true);
    expect(pdfPageCount(bytes)).toBe(1);
  });
});
