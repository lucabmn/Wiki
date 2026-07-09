import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateSpy }));

import { PageContent } from "@/components/editor/page-content";

const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        {
          type: "text",
          text: "the runbook",
          marks: [{ type: "link", attrs: { href: "/pages/p2" } }],
        },
      ],
    },
  ],
};

describe("PageContent", () => {
  it("renders stored TipTap JSON as HTML", () => {
    render(<PageContent content={doc} fallbackText="" />);
    expect(screen.getByText("the runbook")).toBeDefined();
  });

  it("intercepts internal /pages/<id> links for client-side navigation", () => {
    render(<PageContent content={doc} fallbackText="" />);
    const link = screen.getByText("the runbook");
    link.click();
    expect(navigateSpy).toHaveBeenCalledWith({ to: "/pages/$id", params: { id: "p2" } });
  });

  it("falls back to plain text when there is no rich content", () => {
    render(<PageContent content={null} fallbackText="just text" />);
    expect(screen.getByText("just text")).toBeDefined();
  });

  it("shows an empty hint when there is neither content nor text", () => {
    render(<PageContent content={null} fallbackText="   " />);
    expect(screen.getByText("Diese Seite hat noch keinen Inhalt.")).toBeDefined();
  });
});
