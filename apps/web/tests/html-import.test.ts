import { describe, expect, it } from "vitest";

import { parseHtmlFiles, parseHtmlSource, prepareHtmlMigration } from "@/lib/html-import";

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

  it("collects supplied assets but never schedules server-side remote fetches", async () => {
    const html = new File(
      [
        `<main><h1>Assets</h1><p><img src="images/local.png" alt="Local"><img src="https://cdn.example.com/remote.jpg" alt="Remote"><a href="files/guide.pdf">Guide</a></p></main>`,
      ],
      "index.html",
      { type: "text/html" },
    );
    const image = new File(["png"], "local.png", { type: "image/png" });
    const pdf = new File(["pdf"], "guide.pdf", { type: "application/pdf" });
    Object.defineProperty(html, "webkitRelativePath", { value: "docs/index.html" });
    Object.defineProperty(image, "webkitRelativePath", { value: "docs/images/local.png" });
    Object.defineProperty(pdf, "webkitRelativePath", { value: "docs/files/guide.pdf" });

    const bundle = await prepareHtmlMigration([html, image, pdf]);
    expect(bundle.assets).toHaveLength(2);
    expect(bundle.assets.some((asset) => asset.file === image)).toBe(true);
    expect(bundle.assets.some((asset) => asset.file === pdf)).toBe(true);
    expect(bundle.assets.some((asset) => asset.sourcePath.includes("cdn.example.com"))).toBe(false);
    expect(JSON.stringify(bundle.pages[0]?.content)).toContain("migration-asset:");
    expect(JSON.stringify(bundle.pages[0]?.content)).toContain("[Bild: Remote]");
  });

  it("attaches unreferenced documents but ignores technical export files", async () => {
    const html = new File(["<h1>Root</h1>"], "index.html", { type: "text/html" });
    const document = new File(["pdf"], "orphan.pdf", { type: "application/pdf" });
    const stylesheet = new File(["css"], "site.css", { type: "text/css" });
    const bundle = await prepareHtmlMigration([html, document, stylesheet]);

    expect(bundle.assets.some((asset) => asset.fileName === "orphan.pdf")).toBe(true);
    expect(bundle.ignoredFiles).toContain("site.css");
    expect(bundle.pages[0]?.warnings.join(" ")).toContain("Nicht verlinktes Asset");
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
