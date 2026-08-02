import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { references } = vi.hoisted(() => ({
  references: { backlinks: [] as unknown[], outgoing: [] as unknown[] },
}));

// The aside fetches its own backlink/outgoing-link lists; drive both off the
// query key so a test can set either side independently.
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => ({
    data: references[opts.queryKey[0] as keyof typeof references],
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    links: {
      backlinks: { queryOptions: () => ({ queryKey: ["backlinks"] }) },
      outgoing: { queryOptions: () => ({ queryKey: ["outgoing"] }) },
    },
  },
}));

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

function renderAside(overrides: Partial<Parameters<typeof PageAside>[0]> = {}) {
  const props = {
    page,
    headings,
    nameOf,
    commentCount: 3,
    onOpenHistory: vi.fn(),
    onJumpToComments: vi.fn(),
    ...overrides,
  };
  render(<PageAside {...props} />);
  return props;
}

describe("PageAside", () => {
  it("renders metadata rows with resolved author names", () => {
    renderAside({ headings: [] });
    expect(screen.getByText("Erstellt von")).toBeDefined();
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
    expect(screen.getByText("Bearbeitet von")).toBeDefined();
  });

  it("renders a TOC that skips empty headings and defaults the first as active", () => {
    renderAside();
    expect(screen.getByText("Details")).toBeDefined();
    // Two non-empty headings → two TOC buttons (plus the action buttons).
    const intro = screen.getByText("Intro");
    // The first heading is active by default (highlighted).
    expect(intro.className).toContain("text-primary");
  });

  it("scrolls to a heading on click", () => {
    const scrollSpy = vi.fn();
    const el = document.createElement("div");
    el.scrollIntoView = scrollSpy;
    vi.spyOn(document, "getElementById").mockReturnValue(el);
    renderAside();
    screen.getByText("Details").click();
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    vi.restoreAllMocks();
  });

  it("opens the version history and jumps to comments", () => {
    const props = renderAside({ commentCount: 3 });
    fireEvent.click(screen.getByText("Versionsverlauf"));
    expect(props.onOpenHistory).toHaveBeenCalled();
    fireEvent.click(screen.getByText("3 Kommentare"));
    expect(props.onJumpToComments).toHaveBeenCalled();
  });

  it("singularizes the comment label", () => {
    renderAside({ commentCount: 1 });
    expect(screen.getByText("1 Kommentar")).toBeDefined();
  });

  it("omits the reference block entirely when the page has no links", () => {
    references.backlinks = [];
    references.outgoing = [];
    renderAside();
    expect(screen.queryByText("Verlinkt von")).toBeNull();
    expect(screen.queryByText("Verweist auf")).toBeNull();
  });

  it("lists backlinks and outgoing links separately", () => {
    references.backlinks = [{ id: "p2", title: "Onboarding", icon: null }];
    references.outgoing = [{ id: "p3", title: "Deploy-Checkliste", icon: null }];
    renderAside();
    expect(screen.getByText("Verlinkt von")).toBeDefined();
    expect(screen.getByText("Onboarding")).toBeDefined();
    expect(screen.getByText("Verweist auf")).toBeDefined();
    expect(screen.getByText("Deploy-Checkliste")).toBeDefined();
    references.backlinks = [];
    references.outgoing = [];
  });

  it("shows only the side that has links", () => {
    references.backlinks = [{ id: "p2", title: "Onboarding", icon: null }];
    references.outgoing = [];
    renderAside();
    expect(screen.getByText("Verlinkt von")).toBeDefined();
    expect(screen.queryByText("Verweist auf")).toBeNull();
    references.backlinks = [];
  });
});
