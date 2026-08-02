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

  it("opens an external link in a new tab with a safe rel", () => {
    const withExternal = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "the spec",
              marks: [{ type: "link", attrs: { href: "https://example.com/spec" } }],
            },
          ],
        },
      ],
    };
    render(<PageContent content={withExternal} fallbackText="" />);
    const link = screen.getByText("the spec");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("leaves internal links navigable in place", () => {
    render(<PageContent content={doc} fallbackText="" />);
    // No new tab: the click handler routes these client-side.
    expect(screen.getByText("the runbook").getAttribute("target")).toBeNull();
  });

  it("strips the href of a non-http scheme instead of rendering it", () => {
    // Document JSON can reach the database through the API as well as through
    // the editor, so the renderer is the last line of defence here.
    const hostile = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "click me",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    render(<PageContent content={hostile} fallbackText="" />);
    expect(screen.getByText("click me").hasAttribute("href")).toBe(false);
  });

  it("renders safe imported images and strips unsafe sources", () => {
    const withImages = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "https://api.example.com/attachments/a/inline", alt: "Safe" },
            },
            { type: "image", attrs: { src: "javascript:alert(1)", alt: "Unsafe" } },
          ],
        },
      ],
    };
    render(<PageContent content={withImages} fallbackText="" />);
    expect(screen.getByAltText("Safe").getAttribute("src")).toContain("/attachments/a/inline");
    expect(screen.getByAltText("Unsafe").hasAttribute("src")).toBe(false);
  });

  it("drops injected CSS while preserving supported alignment", () => {
    const withStyles = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left;background-image:url(https://attacker.invalid/pixel)" },
          content: [{ type: "text", text: "Hostile style" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [{ type: "text", text: "Centered" }],
        },
      ],
    };
    render(<PageContent content={withStyles} fallbackText="" />);
    expect(screen.getByText("Hostile style").getAttribute("style")).toBe("text-align: left;");
    expect(screen.getByText("Hostile style").getAttribute("style")).not.toContain("background");
    expect(screen.getByText("Centered").getAttribute("style")).toBe("text-align: center;");
  });

  it("injects positional ids into headings so the TOC can target them", () => {
    const withHeadings = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "First" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Second" }] },
      ],
    };
    render(<PageContent content={withHeadings} fallbackText="" />);
    expect(screen.getByText("First").id).toBe("heading-0");
    expect(screen.getByText("Second").id).toBe("heading-1");
  });
});
