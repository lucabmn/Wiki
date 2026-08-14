import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data, selectSpy, moveSpy } = vi.hoisted(() => ({
  data: { pages: [] as Array<Record<string, unknown>> },
  selectSpy: vi.fn(),
  // Typed by what `pages.move` is actually called with, so the assertion below
  // can read the first argument.
  moveSpy: vi.fn(async (_args: Record<string, unknown>) => ({})),
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
      move: { mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: moveSpy, ...o }) },
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
    moveSpy.mockClear();
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

describe("PageTree reordering without a pointer", () => {
  // Dragging is unusable with a keyboard, a screen reader or a switch device.
  // These are the paths that make the tree reorderable without one.
  beforeEach(() => {
    data.pages = [
      { id: "a", parentId: null, title: "Guide", icon: null },
      { id: "a1", parentId: "a", title: "Setup", icon: null },
      { id: "b", parentId: null, title: "Notes", icon: null },
    ];
    moveSpy.mockClear();
  });

  it("offers a move menu on every row when the caller may reorder", async () => {
    renderTree(true);
    await screen.findByText("Guide");
    expect(screen.getByLabelText('Seite „Notes" verschieben')).toBeDefined();
  });

  // Base UI throws "MenuGroupContext is missing" when a GroupLabel mounts
  // outside a Menu.Group, and only once the menu content actually mounts.
  it("mounts the move menu content", async () => {
    renderTree(true);
    await screen.findByText("Guide");
    fireEvent.click(screen.getByLabelText('Seite „Notes" verschieben'));
    expect(await screen.findByText("Verschieben")).toBeDefined();
  });

  it("offers no move affordance when the caller may not reorder", async () => {
    renderTree(false);
    await screen.findByText("Guide");
    expect(screen.queryByLabelText('Seite „Notes" verschieben')).toBeNull();
  });

  it("moves a page with Alt + arrow on the focused row", async () => {
    renderTree(true);
    const notes = await screen.findByText("Notes");
    fireEvent.keyDown(notes.closest("button")!, { key: "ArrowUp", altKey: true });
    // "Notes" is the second root page, so up means before "Guide". Asserted on
    // the first argument only — react-query passes its own context as a second.
    await waitFor(() => expect(moveSpy).toHaveBeenCalled());
    expect(moveSpy.mock.calls[0]?.[0]).toEqual({ id: "b", parentId: null, beforeId: "a" });
  });

  it("ignores an arrow key without Alt, so tree navigation still works", async () => {
    renderTree(true);
    const notes = await screen.findByText("Notes");
    fireEvent.keyDown(notes.closest("button")!, { key: "ArrowUp" });
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it("does nothing for a move there is no room for", async () => {
    renderTree(true);
    const guide = await screen.findByText("Guide");
    // "Guide" is already the first root page.
    fireEvent.keyDown(guide.closest("button")!, { key: "ArrowUp", altKey: true });
    expect(moveSpy).not.toHaveBeenCalled();
  });
});
