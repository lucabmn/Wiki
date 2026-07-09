import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageAside } from "@/components/editor/page-aside";
import type { Heading } from "@/components/editor/headings";

const page = {
  id: "p1",
  spaceId: "s1",
  title: "Runbook",
  status: "published",
  content: null,
  textContent: "",
  createdBy: "u1",
  lastEditedBy: "u2",
  publishedAt: new Date("2026-02-01T09:00:00Z"),
  updatedAt: new Date("2026-03-02T10:00:00Z"),
  createdAt: new Date("2026-01-01T08:00:00Z"),
} as never;

const headings: Heading[] = [
  { id: "heading-0", level: 1, text: "Intro" },
  { id: "heading-1", level: 2, text: "Details" },
  { id: "heading-2", level: 1, text: "" },
];

const nameOf = (id: string | null) =>
  id === "u1" ? "Alice" : id === "u2" ? "Bob" : id ? "Unbekannt" : "—";

describe("PageAside", () => {
  it("renders the metadata rows with resolved author names", () => {
    render(<PageAside page={page} headings={[]} nameOf={nameOf} />);
    expect(screen.getByText("Erstellt von")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
    expect(screen.getByText("Bearbeitet von")).toBeDefined();
    expect(screen.getByText("Zuletzt geändert")).toBeDefined();
    // "Veröffentlicht" is both the status badge and the published-date row.
    expect(screen.getAllByText("Veröffentlicht").length).toBe(2);
  });

  it("renders a TOC that skips empty headings and scrolls on click", () => {
    const scrollSpy = vi.fn();
    const el = document.createElement("div");
    el.scrollIntoView = scrollSpy;
    vi.spyOn(document, "getElementById").mockReturnValue(el);

    render(<PageAside page={page} headings={headings} nameOf={nameOf} />);
    expect(screen.getByText("Intro")).toBeDefined();
    expect(screen.getByText("Details")).toBeDefined();
    // Only the two non-empty headings become TOC entries.
    expect(screen.getAllByRole("button")).toHaveLength(2);

    screen.getByText("Details").click();
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    vi.restoreAllMocks();
  });
});
