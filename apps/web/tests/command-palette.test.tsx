import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// --- mocks ---------------------------------------------------------------

const { navigateSpy, searchHits, courseHits } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  searchHits: vi.fn<() => Array<Record<string, unknown>>>(() => []),
  courseHits: vi.fn<() => Array<Record<string, unknown>>>(() => []),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateSpy }));

// Stand in for the real oRPC client so no network / env is touched: the query
// option just resolves to whatever `searchHits` returns for the given input.
vi.mock("@/utils/orpc", () => ({
  orpc: {
    search: {
      pages: {
        queryOptions: ({ input, enabled }: { input: { query: string }; enabled?: boolean }) => ({
          queryKey: ["search", input.query],
          queryFn: async () => searchHits(),
          enabled,
        }),
      },
      courses: {
        queryOptions: ({ input, enabled }: { input: { query: string }; enabled?: boolean }) => ({
          queryKey: ["search-courses", input.query],
          queryFn: async () => courseHits(),
          enabled,
        }),
      },
    },
  },
}));

import { CommandPalette } from "@/components/command-palette";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("CommandPalette", () => {
  it("prompts before enough input is typed", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} />, { wrapper });
    expect(screen.getByPlaceholderText("Seiten suchen …")).toBeDefined();
    expect(screen.getByText("Tippe, um zu suchen.")).toBeDefined();
  });

  it("shows search hits and navigates to the picked page", async () => {
    searchHits.mockReturnValue([
      {
        pageId: "p1",
        spaceId: "s1",
        title: "Onboarding Guide",
        slug: "onboarding",
        icon: null,
        snippet: "how to start",
        rank: 1,
      },
    ]);
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />, { wrapper });

    fireEvent.change(screen.getByPlaceholderText("Seiten suchen …"), {
      target: { value: "onboarding" },
    });

    // Debounced (150ms) query resolves to the mocked hit.
    const hit = await screen.findByText("Onboarding Guide");
    fireEvent.click(hit);

    expect(navigateSpy).toHaveBeenCalledWith({ to: "/pages/$id", params: { id: "p1" } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists courses in their own group and navigates by slug", async () => {
    // Pages and courses come back from different corpora, so they are two
    // groups rather than one re-ranked list — assert both can appear at once.
    searchHits.mockReturnValue([
      {
        pageId: "p1",
        spaceId: "s1",
        title: "Onboarding Guide",
        slug: "onboarding",
        icon: null,
        snippet: "",
        rank: 1,
      },
    ]);
    courseHits.mockReturnValue([
      {
        courseId: "c1",
        title: "Onboarding für neue Kolleg:innen",
        slug: "onboarding-kurs",
        tagline: "Die ersten zwei Wochen",
        thumbnailUrl: null,
        snippet: "",
        rank: 1,
      },
    ]);
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} />, { wrapper });

    fireEvent.change(screen.getByPlaceholderText("Seiten suchen …"), {
      target: { value: "onboarding" },
    });

    const course = await screen.findByText("Onboarding für neue Kolleg:innen");
    expect(screen.getByText("Onboarding Guide")).toBeDefined();
    fireEvent.click(course);

    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/learn/courses/$slug",
      params: { slug: "onboarding-kurs" },
    });
  });

  it("reports no matches when the search is empty", async () => {
    searchHits.mockReturnValue([]);
    courseHits.mockReturnValue([]);
    render(<CommandPalette open onOpenChange={vi.fn()} />, { wrapper });

    fireEvent.change(screen.getByPlaceholderText("Seiten suchen …"), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText("Keine Treffer.")).toBeDefined();
  });

  it("jumps to the full search page for all results", async () => {
    searchHits.mockReturnValue([
      {
        pageId: "p1",
        spaceId: "s1",
        title: "Runbook",
        slug: "runbook",
        icon: null,
        snippet: "restart",
        rank: 1,
      },
    ]);
    render(<CommandPalette open onOpenChange={vi.fn()} />, { wrapper });

    fireEvent.change(screen.getByPlaceholderText("Seiten suchen …"), {
      target: { value: "runbook" },
    });

    const seeAll = await screen.findByText(/Alle Ergebnisse für/);
    fireEvent.click(seeAll);
    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "runbook", space: "" },
    });
  });
});
