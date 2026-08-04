import { describe, expect, it } from "vitest";

import { sanitizeSvg } from "@/components/editor/mermaid";

/**
 * XSS regression suite for diagram rendering — the highest-stakes test in the
 * feature. Mermaid turns one user's text into markup that every other user of
 * the wiki gets shown, so the allowlist has to hold even when Mermaid's own
 * `securityLevel: "strict"` does not.
 */
describe("sanitizeSvg", () => {
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;

  it("keeps ordinary diagram markup", () => {
    const clean = sanitizeSvg(
      wrap('<g><rect x="1" y="2" fill="url(#grad)"/><text>Start</text></g>'),
    );

    expect(clean).toContain("<rect");
    expect(clean).toContain("Start");
    // Internal paint references survive; only outbound ones are cut.
    expect(clean).toContain("url(#grad)");
  });

  it("drops script elements", () => {
    const clean = sanitizeSvg(wrap("<script>alert(1)</script><rect/>"));

    expect(clean).not.toContain("script");
    expect(clean).toContain("<rect");
  });

  it("drops foreignObject, where HTML labels would smuggle markup in", () => {
    const clean = sanitizeSvg(
      wrap('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>'),
    );

    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("hi");
  });

  it("strips event handlers", () => {
    const clean = sanitizeSvg(wrap('<rect onclick="alert(1)" onload="alert(2)" width="4"/>'));

    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onload");
    expect(clean).toContain('width="4"');
  });

  it("strips javascript: and off-document references", () => {
    const clean = sanitizeSvg(
      wrap(
        '<a href="javascript:alert(1)"><text>klick</text></a>' +
          '<use xlink:href="https://evil.example/x#y"/>' +
          '<rect style="fill:url(https://evil.example/x)"/>',
      ),
    );

    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("evil.example");
  });

  it("drops a stylesheet that tries to reach off the page", () => {
    const clean = sanitizeSvg(wrap('<style>@import url("https://evil.example/x.css");</style>'));

    expect(clean).not.toContain("@import");
    expect(clean).not.toContain("evil.example");
  });

  it("keeps the diagram's own theme stylesheet", () => {
    const clean = sanitizeSvg(wrap("<style>.node rect { fill: #eee; }</style>"));

    expect(clean).toContain("fill: #eee");
  });

  it("refuses anything that is not an SVG document", () => {
    expect(sanitizeSvg("<div>not svg</div>")).toBeNull();
    expect(sanitizeSvg("<svg><unclosed>")).toBeNull();
  });
});
