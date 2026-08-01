import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "Unterstrichen" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Hochgestellt" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tiefgestellt" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Code-Block" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Trennlinie" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Formatierung entfernen" })).toBeDefined();
    // Grouped controls surface as dropdown/popover triggers.
    expect(screen.getByRole("button", { name: "Listen" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ausrichtung" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Tabelle" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Farbe" })).toBeDefined();
    // Internal and external linking share one menu.
    expect(screen.getByRole("button", { name: "Verlinken" })).toBeDefined();

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

  it("opens the external-link dialog from the slash menu and inserts the link", async () => {
    const { getEditor } = renderEditor();
    await waitFor(() => expect(getEditor()).not.toBeNull());

    // Drive the real suggestion plugin: typing "/" opens the menu.
    act(() => {
      getEditor()?.commands.insertContent("/");
    });
    const entry = await screen.findByRole("option", { name: /Externer Link/ });
    act(() => {
      entry.click();
    });

    // The trigger text is gone and the dialog took over.
    expect(getEditor()?.getText()).toBe("");
    const url = await screen.findByLabelText("URL");
    fireEvent.change(url, { target: { value: "example.com/docs" } });
    fireEvent.click(screen.getByText("Einfügen"));

    // Nothing was selected, so the link carries the host as its text — and the
    // href is the normalizer's output, not the raw input.
    await waitFor(() => expect(getEditor()?.getText()).toBe("example.com"));
    expect(getEditor()?.getHTML()).toContain('href="https://example.com/docs"');
  });

  it("reports a live word and character count", async () => {
    const { getEditor } = renderEditor();
    await waitFor(() => expect(getEditor()).not.toBeNull());
    act(() => {
      getEditor()?.commands.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "zwei wörter" }] }],
      });
    });
    // CharacterCount is editor-only — it adds no nodes or marks, so the collab
    // server and the read-only renderer keep the identical shared schema.
    await waitFor(() => expect(screen.getByText("2 Wörter · 11 Zeichen")).toBeDefined());
  });
});
