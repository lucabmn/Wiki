import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real RichTextEditor (real TipTap) — this test exists precisely to catch what
// the stubbed page-editor test can't: behavior that depends on TipTap actually
// running (title-only saves, link serialization).
const { data, updateSpy } = vi.hoisted(() => ({
  data: { draft: null as unknown },
  updateSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
}));

vi.mock("@/lib/permissions", () => ({ usePermission: () => false }));
vi.mock("@/components/editor/revision-history", () => ({ RevisionHistory: () => null }));
// The link picker inside the real editor uses search; stub the endpoint only.
vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      get: { key: () => ["page"] },
      list: { key: () => ["pages"] },
      getDraft: {
        queryOptions: () => ({ queryKey: ["draft"], queryFn: async () => data.draft }),
      },
      saveDraft: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...o }),
      },
      deleteDraft: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...o }),
      },
      update: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: updateSpy, ...o }),
      },
      publish: { mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...o }) },
    },
    search: {
      pages: { queryOptions: () => ({ queryKey: ["search"], queryFn: async () => [] }) },
    },
  },
}));

import { PageEditor } from "@/components/editor/page-editor";

const page = {
  id: "p1",
  spaceId: "s1",
  title: "Runbook",
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Restart the pods" }] }],
  },
} as never;

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PageEditor page={page} onDone={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PageEditor (real editor)", () => {
  beforeEach(() => {
    data.draft = null;
    updateSpy.mockClear();
  });

  it("preserves the body text when only the title is edited", async () => {
    renderEditor();
    // Wait for the real editor to mount with the existing body.
    await screen.findByText("Restart the pods");

    fireEvent.change(screen.getByPlaceholderText("Seitentitel"), {
      target: { value: "New Runbook" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const payload = updateSpy.mock.calls[0]?.[0] as { title: string; textContent: string };
    expect(payload.title).toBe("New Runbook");
    // The regression: title-only edits used to send textContent: "".
    expect(payload.textContent).toBe("Restart the pods");
  });
});
