import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

const { renderDiagram } = vi.hoisted(() => ({
  renderDiagram: vi
    .fn<(id: string, text: string) => Promise<{ svg: string }>>()
    .mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4"/></svg>' }),
}));
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn().mockResolvedValue(true), render: renderDiagram },
}));

import { pageEditorExtensions } from "@/components/editor/extensions";
import { createMermaidNodeView } from "@/components/editor/mermaid";

function Harness({
  onReady,
  editable = true,
}: {
  onReady: (e: Editor) => void;
  editable?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: pageEditorExtensions({ mermaidNodeView: createMermaidNodeView() }),
    content: "<p></p>",
  });
  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);
  return <EditorContent editor={editor} />;
}

function mount(editable = true) {
  let editor: Editor | null = null;
  render(<Harness editable={editable} onReady={(instance) => (editor = instance)} />);
  return () => editor;
}

describe("Mermaid node view", () => {
  it("opens a fresh diagram on its source and writes what is typed back", async () => {
    const getEditor = mount();
    await waitFor(() => expect(getEditor()).not.toBeNull());
    act(() => {
      getEditor()!.commands.insertMermaidDiagram({ source: "" });
    });

    // The node view keeps a local draft and commits it to the document after
    // its debounce, so the shared document sees one update, not one per key.
    const textarea = await screen.findByLabelText("Mermaid-Quelltext");
    act(() => {
      fireEvent.change(textarea, { target: { value: "flowchart TD\n  A --> B" } });
    });

    await waitFor(() => expect(getEditor()!.getHTML()).toContain("flowchart TD"), {
      timeout: 2000,
    });
    await waitFor(() => expect(renderDiagram).toHaveBeenCalled());
  });

  it("shows an existing diagram rendered, with edit and delete controls", async () => {
    const getEditor = mount();
    await waitFor(() => expect(getEditor()).not.toBeNull());
    act(() => {
      getEditor()!.commands.insertMermaidDiagram({ source: "flowchart TD\n  A --> B" });
    });

    expect(await screen.findByRole("button", { name: "Diagramm bearbeiten" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Diagramm löschen" })).toBeDefined();
    expect(screen.queryByLabelText("Mermaid-Quelltext")).toBeNull();
  });

  it("offers no editing controls in a read-only editor", async () => {
    const getEditor = mount(false);
    await waitFor(() => expect(getEditor()).not.toBeNull());
    act(() => {
      getEditor()!.commands.insertContent({
        type: "mermaidDiagram",
        attrs: { source: "flowchart TD\n  A --> B", caption: "Ablauf" },
      });
    });

    await waitFor(() => expect(screen.getByText("Ablauf")).toBeDefined());
    expect(screen.queryByRole("button", { name: "Diagramm bearbeiten" })).toBeNull();
    expect(screen.queryByLabelText("Mermaid-Quelltext")).toBeNull();
  });
});
