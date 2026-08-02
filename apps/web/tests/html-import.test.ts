import { describe, expect, it } from "vitest";

import { parseHtmlFiles, parseHtmlSource } from "@/lib/html-import";

describe("HTML import preparation", () => {
  it("extracts Drupal body content and removes active markup", () => {
    const page = parseHtmlSource(
      "handbook.html",
      `<!doctype html><html><head><title>Fallback</title></head><body>
        <nav>Navigation</nav><h1>Wrong heading</h1>
        <div class="node__content"><h1>Handbook</h1><p>Hello <strong>team</strong>.</p><script>alert(1)</script></div>
      </body></html>`,
    );

    expect(page.title).toBe("Handbook");
    expect(page.textContent).toContain("Hello team");
    expect(JSON.stringify(page.content)).not.toContain("alert");
    expect(JSON.stringify(page.content)).toContain('"type":"bold"');
  });

  it("drops unsafe links and represents images as accessible text", () => {
    const page = parseHtmlSource(
      "links.htm",
      `<main><p><a href="javascript:alert(1)">Bad</a> <a href="https://example.com">Good</a><img src="x" alt="Diagram"></p></main>`,
    );
    const json = JSON.stringify(page.content);

    expect(json).not.toContain("javascript");
    expect(json).toContain("https://example.com");
    expect(json).toContain("[Bild: Diagram]");
    expect(page.warnings.length).toBeGreaterThan(0);
  });

  it("preserves directory hierarchy through index pages", async () => {
    const index = new File(["<h1>Guide</h1>"], "index.html", { type: "text/html" });
    const child = new File(["<h1>Install</h1>"], "install.html", { type: "text/html" });
    Object.defineProperty(index, "webkitRelativePath", { value: "guide/index.html" });
    Object.defineProperty(child, "webkitRelativePath", { value: "guide/install.html" });

    const pages = await parseHtmlFiles([index, child]);
    expect(pages[1]?.parentKey).toBe("guide/index.html");
  });
});
