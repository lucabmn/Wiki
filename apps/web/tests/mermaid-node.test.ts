import { adoptMermaidCodeBlocks, MERMAID_NODE_NAME } from "@nilovon-wiki/editor/mermaid-document";
import { Editor, generateHTML, generateJSON, generateText } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { pageEditorExtensions } from "@/components/editor/extensions";
import { parseHtmlSource } from "@/lib/html-import";

const SOURCE = "flowchart TD\n  A[Start] --> B[Ende]";

const document = {
  type: "doc",
  content: [{ type: MERMAID_NODE_NAME, attrs: { source: SOURCE, caption: "Ablauf der Freigabe" } }],
};

function html(content: unknown) {
  return generateHTML(content as Record<string, unknown>, pageEditorExtensions());
}

/**
 * The diagram node's schema half — everything the collab server and the search
 * projection depend on. No Mermaid here: the library never loads for these.
 */
describe("Mermaid diagram node", () => {
  it("survives serialize → deserialize unchanged", () => {
    const serialized = html(document);
    const parsed = generateJSON(serialized, pageEditorExtensions());

    expect(parsed).toEqual(document);
    // Round-tripping twice must be a fixed point, not a slow drift.
    expect(html(parsed)).toBe(serialized);
  });

  it("serializes to a self-describing <pre> block", () => {
    const out = html(document);
    expect(out).toContain(`data-type="${MERMAID_NODE_NAME}"`);
    expect(out).toContain('class="mermaid"');
    expect(out).toContain('data-caption="Ablauf der Freigabe"');
    expect(out).toContain("flowchart TD");
  });

  it("keeps the source out of the search projection", () => {
    const text = generateText(document as Record<string, unknown>, pageEditorExtensions());

    expect(text).not.toContain("flowchart");
    expect(text).not.toContain("A[Start]");
    // The caption is the searchable part, by design.
    expect(text).toContain("Ablauf der Freigabe");
  });

  it("keeps markup in the source and caption inert", () => {
    const out = html({
      type: "doc",
      content: [
        {
          type: MERMAID_NODE_NAME,
          attrs: {
            source: "<script>alert(1)</script>",
            caption: '"><img src=x onerror=alert(1)>',
          },
        },
      ],
    });

    // Parse the serializer's output the way the browser will: the payload has
    // to stay text and attribute value, never elements.
    const template = window.document.createElement("template");
    template.innerHTML = out;
    expect(template.content.querySelectorAll("script, img")).toHaveLength(0);
    expect(template.content.querySelector("pre")?.textContent).toBe("<script>alert(1)</script>");
  });

  it("inserts through the editor command and stays a block", () => {
    const editor = new Editor({ extensions: pageEditorExtensions(), content: "<p></p>" });
    editor.commands.insertMermaidDiagram({ source: SOURCE });

    const json = editor.getJSON() as { content?: Array<{ type?: string; attrs?: never }> };
    expect(json.content?.some((node) => node.type === MERMAID_NODE_NAME)).toBe(true);
    editor.destroy();
  });

  it("parses a ```mermaid fence and leaves other code blocks alone", () => {
    const parsed = generateJSON(
      `<pre><code class="language-mermaid">${SOURCE}</code></pre><pre><code>const a = 1;</code></pre>`,
      pageEditorExtensions(),
    ) as { content: Array<{ type: string; attrs?: { source?: string } }> };

    expect(parsed.content[0]?.type).toBe(MERMAID_NODE_NAME);
    expect(parsed.content[0]?.attrs?.source).toContain("flowchart TD");
    expect(parsed.content[1]?.type).toBe("codeBlock");
  });

  it("adopts ```mermaid code blocks coming from an importer", () => {
    const adopted = adoptMermaidCodeBlocks({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: SOURCE }],
        },
        { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "1" }] },
      ],
    }) as { content: Array<{ type: string; attrs?: { source?: string } }> };

    expect(adopted.content[0]).toEqual({
      type: MERMAID_NODE_NAME,
      attrs: { source: SOURCE, caption: null },
    });
    expect(adopted.content[1]?.type).toBe("codeBlock");
  });

  it("imports an HTML diagram block back into a node", () => {
    const page = parseHtmlSource(
      "diagram.html",
      `<main><h1>Prozess</h1><pre class="mermaid">${SOURCE}</pre><pre><code>plain</code></pre></main>`,
    );
    const nodes = page.content.content ?? [];

    expect(nodes[0]?.type).toBe(MERMAID_NODE_NAME);
    expect(String(nodes[0]?.attrs?.source)).toContain("flowchart TD");
    expect(nodes[1]?.type).toBe("codeBlock");
  });
});
