import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// The link picker pulls in the orpc client; stub it (search isn't exercised
// here). The mention suggestion only hits `client` lazily on an `@` trigger.
vi.mock("@/utils/orpc", () => ({
  orpc: {
    search: {
      pages: {
        queryOptions: () => ({ queryKey: ["search"], queryFn: async () => [] }),
      },
    },
  },
  client: {
    spaceMembers: { list: vi.fn(async () => []) },
  },
}));

import { RichTextEditor } from "@/components/editor/rich-text-editor";

/**
 * Minimal in-memory Awareness for the CollaborationCaret extension — enough
 * API surface for y-tiptap's cursor plugin in a single-client jsdom mount.
 */
class AwarenessStub {
  clientID: number;
  states = new Map<number, Record<string, unknown>>();
  meta = new Map<number, unknown>();
  doc: Y.Doc;
  constructor(doc: Y.Doc) {
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

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const doc = new Y.Doc();
  const provider = { awareness: new AwarenessStub(doc) } as unknown as HocuspocusProvider;
  let editor: Editor | null = null;
  const view = render(
    <QueryClientProvider client={client}>
      <RichTextEditor
        spaceId="s1"
        doc={doc}
        provider={provider}
        user={{ name: "Luca", color: "hsl(120 70% 50%)" }}
        onEditor={(instance) => {
          editor = instance;
        }}
      />
    </QueryClientProvider>,
  );
  return { view, getEditor: () => editor };
}

describe("RichTextEditor (real TipTap mount)", () => {
  it("mounts, renders the toolbar and accepts content", async () => {
    const { getEditor } = renderEditor();
    // Toolbar controls come from the real component, so a mount/config failure
    // (bad StarterKit option, collab misconfiguration, SSR crash) surfaces here.
    expect(await screen.findByRole("button", { name: "Fett" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Seite verknüpfen" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Hochgestellt" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tiefgestellt" })).toBeDefined();
    // Grouped controls surface as dropdown/popover triggers.
    expect(screen.getByRole("button", { name: "Listen" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ausrichtung" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tabelle" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Farbe" })).toBeDefined();

    // Content lives in the shared Yjs doc; without a collab server the doc
    // starts empty, so drive the live instance the way a sync/restore would.
    await waitFor(() => expect(getEditor()).not.toBeNull());
    act(() => {
      getEditor()?.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      });
    });
    await waitFor(() => expect(screen.getByText("hello")).toBeDefined());
  });
});
