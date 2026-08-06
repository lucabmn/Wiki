import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data, selectSpy } = vi.hoisted(() => ({
  data: { pages: [] as Array<Record<string, unknown>> },
  selectSpy: vi.fn(),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      key: () => ["pages"],
      tree: {
        queryOptions: () => ({ queryKey: ["page-tree"], queryFn: async () => data.pages }),
        key: () => ["page-tree"],
      },
      list: {
        queryOptions: () => ({ queryKey: ["pages"], queryFn: async () => data.pages }),
        key: () => ["pages"],
      },
      move: { mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...o }) },
    },
  },
}));

import { PageTree } from "@/components/page-tree/page-tree";

function renderTree(canReorder = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PageTree spaceId="s1" activePage={null} canReorder={canReorder} onSelectPage={selectSpy} />
    </QueryClientProvider>,
  );
}

describe("PageTree", () => {
  beforeEach(() => {
    data.pages = [
      { id: "a", parentId: null, title: "Guide", icon: null },
      { id: "a1", parentId: "a", title: "Setup", icon: null },
      { id: "b", parentId: null, title: "Notes", icon: null },
    ];
    selectSpy.mockClear();
  });

  it("renders the nested tree", async () => {
    renderTree();
    expect(await screen.findByText("Guide")).toBeDefined();
    expect(screen.getByText("Setup")).toBeDefined();
    expect(screen.getByText("Notes")).toBeDefined();
  });

  it("collapses a node to hide its children", async () => {
    renderTree();
    await screen.findByText("Guide");
    // "Guide" has a child, so it gets a collapse toggle.
    fireEvent.click(screen.getByLabelText("Einklappen"));
    expect(screen.queryByText("Setup")).toBeNull();
    expect(screen.getByText("Guide")).toBeDefined();
  });

  it("selects a page when its row is clicked", async () => {
    renderTree();
    fireEvent.click(await screen.findByText("Setup"));
    expect(selectSpy).toHaveBeenCalledWith("a1");
  });

  it("renders draggable rows when reordering is permitted", async () => {
    renderTree(true);
    // The row button carries dnd-kit's drag attributes when draggable.
    const row = await screen.findByText("Guide");
    expect(row.closest("button")?.getAttribute("aria-roledescription")).toBe("sortable");
  });
});
