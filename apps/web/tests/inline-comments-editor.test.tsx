import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

const { comments, create } = vi.hoisted(() => ({
  comments: { rows: [] as unknown[] },
  create: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "comments" ? comments.rows : [],
  }),
  useMutation: (options: { mutationKey?: string } | undefined) => ({
    mutate: (input: unknown) => create(options, input),
    isPending: false,
  }),
}));

vi.mock("@/utils/orpc", () => {
  const mutation = { mutationOptions: () => ({}) };
  return {
    orpc: {
      comments: {
        list: { key: () => ["comments"], queryOptions: () => ({ queryKey: ["comments"] }) },
        create: mutation,
        resolve: mutation,
        delete: mutation,
      },
      spaceMembers: { list: { queryOptions: () => ({ queryKey: ["members"] }) } },
    },
  };
});

vi.mock("@/lib/query", () => ({ toastError: vi.fn(), useInvalidate: () => vi.fn() }));

import { parseCommentAnchor } from "@nilovon-wiki/editor/comment-anchor";
import { commentMarkIds, commentMarkText } from "@nilovon-wiki/editor/comment-mark";
import { InlineComments } from "@/components/comments/inline-comments";
import { pageEditorExtensions } from "@/components/editor/extensions";

/** The edit view: a live editor with a selection, plus the comment layer. */
function EditView({ onReady }: { onReady: (editor: Editor) => void }) {
  const content = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const instance = new Editor({
      element,
      extensions: pageEditorExtensions(),
      content: "<p>alpha beta gamma</p>",
    });
    setEditor(instance);
    onReady(instance);
    return () => instance.destroy();
  }, [onReady]);

  return (
    <>
      <div ref={content} />
      <InlineComments
        pageId="p1"
        spaceId="s1"
        contentRef={content}
        editor={editor}
        canComment
        canModerate
        viewerId="u1"
        nameOf={() => "Ada"}
      />
    </>
  );
}

function mount() {
  let editor: Editor | undefined;
  render(<EditView onReady={(instance) => (editor = instance)} />);
  // The bubble's visibility follows an editor event, not a React one.
  act(() => {
    editor!.commands.setTextSelection({ from: 1, to: 11 }); // "alpha beta"
  });
  fireEvent.click(screen.getByText("Kommentieren"));
  return editor!;
}

describe("InlineComments while editing", () => {
  it("anchors the selection and offers the composer against the quoted text", () => {
    comments.rows = [];
    const editor = mount();

    const [markId] = [...commentMarkIds(editor.state.doc)];
    expect(markId).toBeDefined();
    expect(commentMarkText(editor.state.doc, markId!)).toBe("alpha beta");
    expect(screen.getAllByText("alpha beta").length).toBeGreaterThan(0);
  });

  it("sends the mark id and the quoted text as the comment's anchor", () => {
    comments.rows = [];
    create.mockClear();
    const editor = mount();
    const [markId] = [...commentMarkIds(editor.state.doc)];

    fireEvent.change(screen.getByPlaceholderText("Kommentar schreiben …"), {
      target: { value: "Stimmt das noch?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kommentieren" }));

    const input = create.mock.calls.at(-1)?.[1] as { body: string; anchor: unknown };
    expect(input.body).toBe("Stimmt das noch?");
    expect(parseCommentAnchor(input.anchor)).toEqual({
      v: 1,
      type: "mark",
      markId,
      excerpt: "alpha beta",
    });
  });

  it("withdraws the anchor again when the composer is abandoned", () => {
    comments.rows = [];
    const editor = mount();
    expect(commentMarkIds(editor.state.doc).size).toBe(1);

    fireEvent.click(screen.getByText("Abbrechen"));
    expect(commentMarkIds(editor.state.doc).size).toBe(0);
    expect(screen.queryByPlaceholderText("Kommentar schreiben …")).toBeNull();
  });
});
