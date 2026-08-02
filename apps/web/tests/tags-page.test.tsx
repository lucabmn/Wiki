import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { search, tags, pages, navigate } = vi.hoisted(() => ({
  search: { space: "s1", tag: "", q: "" },
  tags: [] as unknown[],
  pages: [] as unknown[],
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    useSearch: () => search,
    ...opts,
  }),
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const kind = opts.queryKey[0];
    if (kind === "spaces") return { data: [{ id: "s1", name: "Handbuch" }], isPending: false };
    if (kind === "tags") return { data: tags, isPending: false };
    return { data: pages, isPending: false };
  },
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    spaces: { list: { queryOptions: () => ({ queryKey: ["spaces"] }) } },
    tags: {
      listWithCounts: {
        queryOptions: (o: { input: { spaceId: string } }) => ({
          queryKey: ["tags", o.input.spaceId],
        }),
      },
      listPages: {
        queryOptions: (o: { input: { tagId: string } }) => ({
          queryKey: ["tag-pages", o.input.tagId],
        }),
      },
    },
  },
}));

import { Route } from "@/routes/_auth/tags";

const TagsPage = (Route as unknown as { component: () => ReactNode }).component;

const tag = (id: string, name: string, pageCount: number) => ({
  id,
  name,
  color: null,
  spaceId: "s1",
  pageCount,
});

describe("tags route", () => {
  beforeEach(() => {
    search.space = "s1";
    search.tag = "";
    search.q = "";
    tags.length = 0;
    pages.length = 0;
    navigate.mockClear();
    tags.push(tag("t1", "Onboarding", 2), tag("t2", "Archiv", 0), tag("t3", "Prozesse", 7));
  });

  it("orders tags by page count, busiest first", () => {
    render(<TagsPage />);

    const names = screen
      .getAllByRole("button", { pressed: false })
      .map((button) => button.textContent);
    expect(names).toEqual(["Prozesse7", "Onboarding2", "Archiv0"]);
  });

  it("shows no result list until a tag is picked", () => {
    render(<TagsPage />);

    expect(screen.queryByText("Filter aufheben")).toBeNull();
  });

  it("lists the pages of the selected tag", () => {
    search.tag = "t1";
    pages.push({ pageId: "p1", title: "Erste Woche", icon: null, updatedAt: new Date() });
    render(<TagsPage />);

    expect(screen.getByText("Erste Woche")).toBeDefined();
    expect(screen.getByText("1 Seite")).toBeDefined();
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("Onboarding2");
  });

  it("explains an unused tag instead of showing an empty list", () => {
    search.tag = "t2";
    render(<TagsPage />);

    expect(screen.getByText("Keine Seiten mit diesem Tag")).toBeDefined();
  });

  it("selects a tag on click and clears it when the same chip is clicked again", () => {
    render(<TagsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Onboarding/ }));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: { space: "s1", tag: "t1", q: "" } }),
    );

    search.tag = "t1";
    render(<TagsPage />);
    fireEvent.click(screen.getByRole("button", { pressed: true }));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: { space: "s1", tag: "", q: "" } }),
    );
  });

  it("says so when the linked tag does not exist here", () => {
    search.tag = "gone";
    render(<TagsPage />);

    expect(screen.getByText("Dieses Tag gibt es in Handbuch nicht.")).toBeDefined();
  });

  it("filters the tag list by the search term", () => {
    search.q = "proz";
    render(<TagsPage />);

    expect(screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual([
      "Prozesse7",
    ]);
  });
});
