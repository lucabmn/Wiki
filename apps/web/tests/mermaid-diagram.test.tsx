import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { parse, renderDiagram } = vi.hoisted(() => ({
  parse: vi.fn<(text: string) => Promise<boolean>>(),
  renderDiagram: vi.fn<(id: string, text: string) => Promise<{ svg: string }>>(),
}));

// Mermaid itself is never exercised in unit tests: it needs layout, and what
// matters here is how this component treats whatever it gets back.
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse, render: renderDiagram },
}));

import { MermaidDiagramView } from "@/components/editor/mermaid";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4"/><text>Start</text></svg>';

describe("MermaidDiagramView", () => {
  it("renders the diagram and its caption", async () => {
    parse.mockResolvedValue(true);
    renderDiagram.mockResolvedValue({ svg: SVG });

    render(<MermaidDiagramView source="flowchart TD\n A-->B" caption="Freigabe" />);

    const figure = await screen.findByRole("img", { name: "Freigabe" });
    expect(figure.querySelector("rect")).not.toBeNull();
    expect(screen.getByText("Freigabe")).toBeDefined();
  });

  it("shows a syntax error inline instead of throwing", async () => {
    parse.mockRejectedValue(new Error("Parse error on line 2:\n  flowchrt TD"));

    render(<MermaidDiagramView source="flowchrt TD" />);

    expect(await screen.findByText(/Parse error on line 2/)).toBeDefined();
    // The source stays visible so the author can see what failed.
    expect(screen.getByText("flowchrt TD")).toBeDefined();
    expect(renderDiagram).not.toHaveBeenCalled();
  });

  it("explains an empty diagram rather than rendering a white box", async () => {
    render(<MermaidDiagramView source="   " />);

    expect(await screen.findByText(/noch keinen Quelltext/)).toBeDefined();
  });

  it("never injects executable markup, whatever Mermaid returns", async () => {
    parse.mockResolvedValue(true);
    renderDiagram.mockResolvedValue({
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        "<script>window.__pwned = true;</script>" +
        '<a xlink:href="javascript:window.__pwned = true"><text>klick</text></a>' +
        '<rect onclick="window.__pwned = true" width="4"/>' +
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="window.__pwned = true"/></div></foreignObject>' +
        "</svg>",
    });

    const { container } = render(<MermaidDiagramView source="graph TD; A[<script>]" />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("foreignObject")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("onclick");
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
