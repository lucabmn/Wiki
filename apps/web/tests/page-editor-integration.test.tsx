import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real RichTextEditor (real TipTap + Yjs) — this test exists precisely to catch
// what the stubbed page-editor test can't: behavior that depends on TipTap
// actually running against the shared collab document (title-only saves must
// flush the live body, not an empty editor).
const { updateSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn((_v?: unknown) => Promise.resolve({})),
}));

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
      publish: { mutationOptions: (o: Record<string, unknown>) => ({ mutationFn: vi.fn(), ...o }) },
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
      <PageEditor page={page} canPublish={false} onDone={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PageEditor (real editor)", () => {
  beforeEach(() => {
    updateSpy.mockClear();
  });

  it("preserves the body text when only the title is edited", async () => {
    renderEditor();
    // Put a body into the live editor, then wait for it to render.
    fireEvent.click(await screen.findByText("seed-revision"));
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
