import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data, navigateSpy } = vi.hoisted(() => ({
  data: {
    search: { q: "", space: "" } as { q: string; space: string },
    hits: [] as Array<Record<string, unknown>>,
    spaces: [] as Array<Record<string, unknown>>,
  },
  navigateSpy: vi.fn(),
}));

vi.mock("@/components/layouts/dashboard-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useSearch: () => data.search,
    ...opts,
  }),
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigateSpy,
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    spaces: {
      list: {
        queryOptions: () => ({ queryKey: ["spaces"], queryFn: async () => data.spaces }),
      },
    },
    search: {
      pages: {
        queryOptions: ({ enabled }: { enabled?: boolean }) => ({
          queryKey: ["search", data.search.q, data.search.space],
          queryFn: async () => data.hits,
          enabled,
        }),
      },
    },
  },
}));

import { Route } from "@/routes/_auth/search";

const SearchView = (Route as unknown as { component: () => ReactNode }).component;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchView />
    </QueryClientProvider>,
  );
}

describe("search route", () => {
  beforeEach(() => {
    data.search = { q: "", space: "" };
    data.hits = [];
    data.spaces = [];
    navigateSpy.mockClear();
  });

  it("prompts for input below the minimum length", () => {
    data.search = { q: "a", space: "" };
    renderView();
    expect(screen.getByText("Tippe mindestens zwei Zeichen.")).toBeDefined();
  });

  it("renders hits with highlighted snippets linking to the page", async () => {
    data.search = { q: "pod", space: "" };
    data.hits = [
      {
        pageId: "p1",
        spaceId: "s1",
        title: "Runbook",
        slug: "runbook",
        icon: null,
        snippet: "restart the <b>pod</b> now",
        rank: 1,
      },
    ];
    renderView();

    expect(await screen.findByText("Runbook")).toBeDefined();
    // The <b> marker becomes a highlighted <mark>, not literal text.
    const mark = await screen.findByText("pod");
    expect(mark.tagName).toBe("MARK");
    const link = mark.closest("a");
    expect(link?.getAttribute("href")).toBeDefined();
  });

  it("reports no matches", async () => {
    data.search = { q: "zzz", space: "" };
    data.hits = [];
    renderView();
    expect(await screen.findByText(/Keine Treffer/)).toBeDefined();
  });

  it("updates the URL query as the user types (debounced)", async () => {
    data.search = { q: "", space: "" };
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Seiten durchsuchen …"), {
      target: { value: "runbook" },
    });
    await waitFor(
      () =>
        expect(navigateSpy).toHaveBeenCalledWith({
          to: "/search",
          search: { q: "runbook", space: "" },
          replace: true,
        }),
      { timeout: 1000 },
    );
  });

  it("scopes the search to a chosen space", async () => {
    data.search = { q: "pod", space: "" };
    data.spaces = [{ id: "s1", slug: "ops", name: "Operations" }];
    renderView();

    // Wait for the space options to load before selecting one.
    await screen.findByText("Operations");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s1" } });
    expect(navigateSpy).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "pod", space: "s1" },
    });
  });
});
