import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real RichTextEditor (real TipTap + Yjs) — this test exists precisely to catch
// what the stubbed page-editor test can't: behavior that depends on TipTap
// actually running against the shared collab document. Publish is the single
// point that promotes the working copy, so it must carry the live body.
const { updateSpy, publishSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
  publishSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
}));

// The editor guards unsaved title edits via router `useBlocker`; there is no
// RouterProvider in this harness, so stub it inert.
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => undefined }));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u1", name: "Luca", email: "luca@acme.io" } } }),
  },
}));

// No collab server in jsdom: replace the Hocuspocus provider with an inert stub
// that still carries a minimal Awareness (the CollaborationCaret extension
// reads `provider.awareness`). The Y.Doc itself is real, so the editor binds to
// it exactly as in production — only the network sync is missing.
vi.mock("@hocuspocus/provider", () => {
  class AwarenessStub {
    clientID: number;
    states = new Map<number, Record<string, unknown>>();
    meta = new Map<number, unknown>();
    doc: unknown;
    constructor(doc: { clientID: number }) {
      this.doc = doc;
      this.clientID = doc.clientID;
    }
    on() {}
    off() {}
    getLocalState() {
      return this.states.get(this.clientID) ?? null;
    }
    getStates() {
      return this.states;
    }
    setLocalState(state: Record<string, unknown>) {
      this.states.set(this.clientID, state);
    }
    setLocalStateField(field: string, value: unknown) {
      this.states.set(this.clientID, { ...this.getLocalState(), [field]: value });
    }
    destroy() {}
  }
  class HocuspocusProvider {
    configuration: { document: { clientID: number } };
    awareness: AwarenessStub;
    constructor(configuration: { document: { clientID: number } }) {
      this.configuration = configuration;
      this.awareness = new AwarenessStub(configuration.document);
    }
    destroy() {}
  }
  return {
    HocuspocusProvider,
    WebSocketStatus: {
      Connecting: "connecting",
      Connected: "connected",
      Disconnected: "disconnected",
    },
  };
});

// The body starts empty (it would normally arrive via collab sync). Seed it
// through the restore pathway PageEditor exposes to the revision history —
// that writes into the live editor exactly like a restored revision would.
vi.mock("@/components/editor/revision-history", () => ({
  RevisionHistory: ({
    onRestore,
  }: {
    onRestore: (revision: { title: string; content: unknown }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onRestore({
          title: "Runbook",
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Restart the pods" }] }],
          },
        })
      }
    >
      seed-revision
    </button>
  ),
}));

// The link picker inside the real editor uses search; the mention suggestion
// hits `client` lazily on an `@` trigger only.
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
    search: {
      pages: { queryOptions: () => ({ queryKey: ["search"], queryFn: async () => [] }) },
    },
  },
  client: {
    pages: { collabToken: vi.fn(async () => ({ token: "t" })) },
    spaceMembers: { list: vi.fn(async () => []) },
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
      <PageEditor page={page} canPublish onDone={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PageEditor (real editor)", () => {
  beforeEach(() => {
    updateSpy.mockClear();
    publishSpy.mockClear();
  });

  it("publish promotes the live body read from the collab document", async () => {
    renderEditor();
    // Put a body into the live editor, then wait for it to render.
    fireEvent.click(await screen.findByText("seed-revision"));
    await screen.findByText("Restart the pods");

    fireEvent.change(screen.getByPlaceholderText("Seitentitel"), {
      target: { value: "New Runbook" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Veröffentlichen" }));

    await waitFor(() => expect(publishSpy).toHaveBeenCalled());
    const payload = publishSpy.mock.calls[0]?.[0] as { title: string; textContent: string };
    expect(payload.title).toBe("New Runbook");
    // The promoted body is read live from the TipTap/Yjs document, not an empty
    // editor — the regression this real-editor test guards against.
    expect(payload.textContent).toBe("Restart the pods");
    // Saving is separate from publishing; publish does not also PATCH the page.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
