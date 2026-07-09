import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { data, saveDraftSpy, deleteDraftSpy, updateSpy, publishSpy, onDoneSpy } = vi.hoisted(() => ({
  data: {
    draft: null as unknown,
    canPublish: false,
  },
  saveDraftSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
  deleteDraftSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
  updateSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
  publishSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
  onDoneSpy: vi.fn(),
}));

vi.mock("@/components/editor/revision-history", () => ({ RevisionHistory: () => null }));

// Stub the TipTap surface: exposes a button that reports an edit upward, and a
// marker of whether it received initial content.
vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: ({
    initialContent,
    onChange,
  }: {
    initialContent: unknown;
    onChange: (v: { json: unknown; text: string }) => void;
  }) => (
    <div>
      <span>RTE:{initialContent ? "has-content" : "empty"}</span>
      <button
        type="button"
        onClick={() =>
          onChange({
            json: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "new body" }] }],
            },
            text: "new body",
          })
        }
      >
        edit-body
      </button>
    </div>
  ),
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      get: { key: () => ["page"] },
      list: { key: () => ["pages"] },
      getDraft: {
        queryOptions: ({ input }: { input: { id: string } }) => ({
          queryKey: ["draft", input.id],
          queryFn: async () => data.draft,
        }),
      },
      saveDraft: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: saveDraftSpy, ...o }),
      },
      deleteDraft: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: deleteDraftSpy, ...o }),
      },
      update: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: updateSpy, ...o }),
      },
      publish: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: publishSpy, ...o }),
      },
    },
  },
}));

import { PageEditor } from "@/components/editor/page-editor";

const page = {
  id: "p1",
  spaceId: "s1",
  title: "Runbook",
  content: null,
} as never;

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PageEditor page={page} canPublish={data.canPublish} onDone={onDoneSpy} />
    </QueryClientProvider>,
  );
}

describe("PageEditor", () => {
  beforeEach(() => {
    data.draft = null;
    data.canPublish = false;
    saveDraftSpy.mockClear();
    deleteDraftSpy.mockClear();
    updateSpy.mockClear();
    publishSpy.mockClear();
    onDoneSpy.mockClear();
  });

  it("saves the page: update with content + textContent, discards draft, exits", async () => {
    renderEditor();
    fireEvent.click(await screen.findByText("edit-body"));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(updateSpy.mock.calls[0]?.[0]).toEqual({
        id: "p1",
        title: "Runbook",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "new body" }] }],
        },
        textContent: "new body",
      }),
    );
    await waitFor(() => expect(deleteDraftSpy.mock.calls[0]?.[0]).toEqual({ id: "p1" }));
    await waitFor(() => expect(onDoneSpy).toHaveBeenCalled());
  });

  it("autosaves the draft after editing", async () => {
    renderEditor();
    fireEvent.click(await screen.findByText("edit-body"));
    await waitFor(
      () =>
        expect(saveDraftSpy.mock.calls[0]?.[0]).toEqual({
          pageId: "p1",
          title: "Runbook",
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "new body" }] }],
          },
        }),
      { timeout: 2000 },
    );
  });

  it("publishes: persists then snapshots a revision", async () => {
    data.canPublish = true;
    renderEditor();
    fireEvent.click(await screen.findByText("edit-body"));
    fireEvent.click(screen.getByRole("button", { name: "Veröffentlichen" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    await waitFor(() => expect(publishSpy.mock.calls[0]?.[0]).toEqual({ id: "p1" }));
    await waitFor(() => expect(onDoneSpy).toHaveBeenCalled());
  });

  it("hides publish without permission", async () => {
    data.canPublish = false;
    renderEditor();
    await screen.findByText("edit-body");
    expect(screen.queryByRole("button", { name: "Veröffentlichen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDefined();
  });

  it("restores an existing draft and shows the banner until edited", async () => {
    data.draft = {
      content: { type: "doc", content: [{ type: "paragraph" }] },
      title: "Draft title",
    };
    renderEditor();
    // The editor mounts with the draft content, and the banner is shown.
    expect(await screen.findByText("RTE:has-content")).toBeDefined();
    expect(screen.getByText(/Entwurf wiederhergestellt/)).toBeDefined();

    fireEvent.click(screen.getByText("edit-body"));
    await waitFor(() => expect(screen.queryByText(/Entwurf wiederhergestellt/)).toBeNull());
  });
});
