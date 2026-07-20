import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    pageTags: [] as unknown[],
    spaceTags: [] as unknown[],
    attach: vi.fn(),
    detach: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: string[] }) => ({
    data: opts.queryKey[0] === "pageTags" ? state.pageTags : state.spaceTags,
  }),
  // The component distinguishes its three mutations only by which orpc entry
  // built them, so pass the marker through from the mocked mutationOptions.
  useMutation: (opts: { kind: keyof typeof state }) => ({
    mutate: state[opts.kind] as ReturnType<typeof vi.fn>,
    isPending: false,
  }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    tags: {
      listForPage: { queryOptions: () => ({ queryKey: ["pageTags"] }) },
      list: { queryOptions: () => ({ queryKey: ["spaceTags"] }), key: () => ["spaceTags"] },
      attach: { mutationOptions: () => ({ kind: "attach" }) },
      detach: { mutationOptions: () => ({ kind: "detach" }) },
      create: { mutationOptions: () => ({ kind: "create" }) },
    },
  },
}));

import { PageTags } from "@/components/pages/page-tags";

const renderTags = (canEdit = true) =>
  render(<PageTags pageId="p1" spaceId="s1" canEdit={canEdit} />);

describe("PageTags", () => {
  it("renders nothing for a read-only viewer when the page has no tags", () => {
    state.pageTags = [];
    const { container } = renderTags(false);
    expect(container.textContent).toBe("");
  });

  it("hides the remove button from read-only viewers", () => {
    state.pageTags = [{ id: "t1", name: "Runbook", color: null }];
    renderTags(false);
    expect(screen.getByText("Runbook")).toBeDefined();
    expect(screen.queryByLabelText("Tag Runbook entfernen")).toBeNull();
  });

  it("detaches a tag on click", () => {
    state.pageTags = [{ id: "t1", name: "Runbook", color: null }];
    state.detach.mockClear();
    renderTags();
    fireEvent.click(screen.getByLabelText("Tag Runbook entfernen"));
    expect(state.detach).toHaveBeenCalledWith({ pageId: "p1", tagId: "t1" });
  });

  it("offers the picker with an add affordance when editable", () => {
    state.pageTags = [];
    renderTags();
    expect(screen.getByText("Tag hinzufügen")).toBeDefined();
  });
});
