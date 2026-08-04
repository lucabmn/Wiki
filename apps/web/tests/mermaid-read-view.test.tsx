import { MERMAID_NODE_NAME } from "@nilovon-wiki/editor/mermaid-document";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { parse, renderDiagram } = vi.hoisted(() => ({
  parse: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
  renderDiagram: vi
    .fn<(id: string, text: string) => Promise<{ svg: string }>>()
    .mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4"/></svg>' }),
}));
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), parse, render: renderDiagram } }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { PageContent } from "@/components/editor/page-content";

const document = {
  type: "doc",
  content: [
    {
      type: MERMAID_NODE_NAME,
      attrs: { source: "flowchart TD\n  A --> B", caption: "Freigabeprozess" },
    },
  ],
};

/**
 * The read path — also what the revision preview renders, since
 * `revision-history.tsx` shows a revision through `PageContent`.
 */
describe("PageContent diagrams", () => {
  it("renders a stored diagram and keeps its source in the document", async () => {
    const { container } = render(<PageContent content={document} fallbackText="" />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(screen.getByRole("img", { name: "Freigabeprozess" })).toBeDefined();
    expect(renderDiagram).toHaveBeenCalledWith(expect.any(String), "flowchart TD\n  A --> B");

    // The `<pre>` stays in the DOM as the machine-readable source, just hidden.
    const source = container.querySelector<HTMLElement>(`pre[data-type="${MERMAID_NODE_NAME}"]`);
    expect(source?.hidden).toBe(true);
    expect(source?.textContent).toContain("flowchart TD");
  });

  it("shows a failing diagram as a message, not as an empty box", async () => {
    parse.mockRejectedValueOnce(new Error("Parse error on line 1"));

    render(<PageContent content={document} fallbackText="" />);

    expect(await screen.findByText(/Parse error on line 1/)).toBeDefined();
  });
});
