import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The old local-draft autosave/restore tests were removed: PageEditor was
// rewritten around real-time collaboration (Hocuspocus/Yjs) and the
// getDraft/saveDraft/deleteDraft flow no longer exists.

const { data, providerControl, updateSpy, publishSpy, onDoneSpy, toastSuccessSpy } = vi.hoisted(
  () => ({
    data: {
      canPublish: false,
    },
    providerControl: {
      hasUnsyncedChanges: false,
      listeners: new Set<(payload: { number: number }) => void>(),
      acknowledge() {
        this.hasUnsyncedChanges = false;
        for (const listener of this.listeners) listener({ number: 0 });
      },
    },
    updateSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
    publishSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
    onDoneSpy: vi.fn(),
    toastSuccessSpy: vi.fn(),
  }),
);

vi.mock("@/components/editor/revision-history", () => ({ RevisionHistory: () => null }));

// The editor guards unsaved title edits via router `useBlocker`; there is no
// RouterProvider in this unit harness, so stub it inert.
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => undefined }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u1", name: "Luca", email: "luca@acme.io" } } }),
  },
}));

// No real WebSocket in jsdom: replace the Hocuspocus provider with an inert
// stub. The unit test stubs the TipTap surface too, so no awareness is needed.
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    configuration: unknown;
    constructor(configuration: unknown) {
      this.configuration = configuration;
    }
    get hasUnsyncedChanges() {
      return providerControl.hasUnsyncedChanges;
    }
    on(event: string, listener: (payload: { number: number }) => void) {
      if (event === "unsyncedChanges") providerControl.listeners.add(listener);
    }
    off(event: string, listener: (payload: { number: number }) => void) {
      if (event === "unsyncedChanges") providerControl.listeners.delete(listener);
    }
    destroy() {}
  },
  WebSocketStatus: {
    Connecting: "connecting",
    Connected: "connected",
    Disconnected: "disconnected",
  },
}));

// Stub the TipTap surface: the collab editor exposes the live instance via
// `onEditor`, which the parent reads at save/publish time (getJSON/getText).
vi.mock("@/components/editor/rich-text-editor", async () => {
  const { useEffect } = await import("react");
  return {
    RichTextEditor: ({ onEditor }: { onEditor?: (editor: unknown) => void }) => {
      useEffect(() => {
        onEditor?.({
          getJSON: () => ({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "new body" }] }],
          }),
          getText: () => "new body",
          commands: { setContent: vi.fn() },
        });
        return () => onEditor?.(null);
      }, [onEditor]);
      return <div>RTE</div>;
    },
  };
});

vi.mock("sonner", () => ({
  toast: { success: toastSuccessSpy, error: vi.fn() },
}));

vi.mock("@/utils/orpc", () => ({
  orpc: {
    pages: {
      get: { key: () => ["page"] },
      list: { key: () => ["pages"] },
      update: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: updateSpy, ...o }),
      },
      publish: {
        mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: publishSpy, ...o }),
      },
    },
  },
  client: {
    pages: { collabToken: vi.fn(async () => ({ token: "t" })) },
  },
}));

import { PageEditor } from "@/components/editor/page-editor";

const page = {
  id: "p1",
  spaceId: "s1",
  title: "Runbook",
  content: null,
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PageEditor page={page as never} canPublish={data.canPublish} onDone={onDoneSpy} />
    </QueryClientProvider>,
  );
}

describe("PageEditor", () => {
  beforeEach(() => {
    data.canPublish = false;
    providerControl.hasUnsyncedChanges = false;
    providerControl.listeners.clear();
    updateSpy.mockClear();
    publishSpy.mockClear();
    onDoneSpy.mockClear();
    toastSuccessSpy.mockClear();
  });

  it("saves the draft: title-only update, toasts, exits (body is autosaved by collab)", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    // The body lives in the collaborative doc and is not flushed on save — only
    // the non-collaborative title is persisted.
    await waitFor(() =>
      expect(updateSpy.mock.calls[0]?.[0]).toEqual({ id: "p1", title: "Runbook" }),
    );
    await waitFor(() => expect(toastSuccessSpy).toHaveBeenCalledWith("Entwurf gespeichert"));
    await waitFor(() => expect(onDoneSpy).toHaveBeenCalled());
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("waits for collaborative body changes to reach the server before closing", async () => {
    providerControl.hasUnsyncedChanges = true;
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    await Promise.resolve();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(onDoneSpy).not.toHaveBeenCalled();

    providerControl.acknowledge();
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    await waitFor(() => expect(onDoneSpy).toHaveBeenCalled());
  });

  it("falls back to 'Ohne Titel' when the title is emptied", async () => {
    renderEditor();
    fireEvent.change(await screen.findByPlaceholderText("Seitentitel"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      const firstCall = updateSpy.mock.calls[0]?.[0] as { title: string } | undefined;
      expect(firstCall?.title).toBe("Ohne Titel");
    });
  });

  it("refetches the saved page before closing so reopening uses the latest title", async () => {
    let resolveRefetch!: (value: typeof page) => void;
    const refetch = new Promise<typeof page>((resolve) => {
      resolveRefetch = resolve;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function ReopeningEditor() {
      const [editing, setEditing] = useState(true);
      const { data: currentPage } = useQuery({
        queryKey: ["page", "p1"],
        queryFn: () => refetch,
        initialData: page,
      });
      return editing ? (
        <PageEditor
          page={currentPage as never}
          canPublish={false}
          onDone={() => setEditing(false)}
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Erneut bearbeiten
        </button>
      );
    }

    render(
      <QueryClientProvider client={client}>
        <ReopeningEditor />
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByPlaceholderText("Seitentitel"), {
      target: { value: "Runbook v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Erneut bearbeiten" })).toBeNull();

    resolveRefetch({ ...page, title: "Runbook v2" });
    fireEvent.click(await screen.findByRole("button", { name: "Erneut bearbeiten" }));
    const reopenedTitle = (await screen.findByPlaceholderText("Seitentitel")) as HTMLInputElement;
    expect(reopenedTitle.value).toBe("Runbook v2");
  });

  it("publishes: promotes body + title via pages.publish, toasts, exits", async () => {
    data.canPublish = true;
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Veröffentlichen" }));

    // Publish is the single point that promotes the working copy — it carries
    // the current body from the live editor plus the title; no separate update.
    await waitFor(() =>
      expect(publishSpy.mock.calls[0]?.[0]).toEqual({
        id: "p1",
        title: "Runbook",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "new body" }] }],
        },
        textContent: "new body",
      }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSuccessSpy).toHaveBeenCalledWith("Seite veröffentlicht"));
    await waitFor(() => expect(onDoneSpy).toHaveBeenCalled());
  });

  it("hides publish without permission", async () => {
    data.canPublish = false;
    renderEditor();
    await screen.findByRole("button", { name: "Speichern" });
    expect(screen.queryByRole("button", { name: "Veröffentlichen" })).toBeNull();
  });

  it("closes without persisting", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Schließen" }));
    expect(onDoneSpy).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
