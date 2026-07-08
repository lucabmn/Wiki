import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// --- mocks ---------------------------------------------------------------

const { navigateSpy, searchHits } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  searchHits: vi.fn<() => Array<Record<string, unknown>>>(() => []),
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

  it("reports no matches when the search is empty", async () => {
    searchHits.mockReturnValue([]);
    render(<CommandPalette open onOpenChange={vi.fn()} />, { wrapper });

    fireEvent.change(screen.getByPlaceholderText("Seiten suchen …"), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText("Keine Treffer.")).toBeDefined();
  });
});
