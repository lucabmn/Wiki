import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

const { comments, mutate } = vi.hoisted(() => ({
  comments: { rows: [] as unknown[] },
  mutate: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "comments" ? comments.rows : [],
  }),
  useMutation: () => ({ mutate, mutateAsync: mutate, isPending: false }),
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

import { createCommentAnchor } from "@nilovon-wiki/editor/comment-anchor";
import { InlineComments } from "@/components/comments/inline-comments";

const nameOf = (userId: string | null) => (userId === "u1" ? "Ada" : "Grace");

function row(id: string, markId: string, excerpt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    parentId: null,
    authorId: "u1",
    body: `${id} body`,
    anchor: createCommentAnchor(markId, excerpt),
    resolvedAt: null,
    deletedAt: null,
    createdAt: new Date(2026, 0, 1),
    ...extra,
  };
}

/**
 * Mirrors the read-only view: annotated text rendered as the shared comment
 * mark serializes it, with the comment layer beside it. No editor — the case
 * most readers are in.
 */
function ReadView({ markIds, canComment = true }: { markIds: string[]; canComment?: boolean }) {
  const content = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={content} className="tiptap">
        <p>
          Vor{" "}
          {markIds.map((id) => (
            <span key={id} data-comment-id={id}>
              {id}-Text
            </span>
          ))}{" "}
          nach
        </p>
      </div>
      <InlineComments
        pageId="p1"
        spaceId="s1"
        contentRef={content}
        canComment={canComment}
        canModerate={false}
        viewerId="u1"
        nameOf={nameOf}
      />
    </>
  );
}

describe("InlineComments in the read-only view", () => {
  it("shows two overlapping anchors as two threads", () => {
    comments.rows = [row("c1", "m1", "alpha beta"), row("c2", "m2", "beta gamma")];
    render(<ReadView markIds={["m1", "m2"]} />);

    expect(screen.getByText("alpha beta")).toBeDefined();
    expect(screen.getByText("beta gamma")).toBeDefined();
    expect(screen.getByText("c1 body")).toBeDefined();
    expect(screen.getByText("c2 body")).toBeDefined();
  });

  it("keeps a comment whose text was deleted, shown as orphaned with its excerpt", () => {
    comments.rows = [row("c1", "gone", "die gelöschte Stelle")];
    render(<ReadView markIds={[]} />);

    expect(screen.getByText("die gelöschte Stelle")).toBeDefined();
    expect(screen.getByText("Textstelle nicht mehr im Dokument")).toBeDefined();
    expect(screen.getByText("c1 body")).toBeDefined();
  });

  it("lights up only anchors it has a thread for", () => {
    comments.rows = [row("c1", "m1", "alpha")];
    const { container } = render(<ReadView markIds={["m1", "stale"]} />);

    expect(container.querySelector('[data-comment-id="m1"]')?.className).toContain(
      "comment-mark--live",
    );
    expect(container.querySelector('[data-comment-id="stale"]')?.className).not.toContain(
      "comment-mark--live",
    );
  });

  it("focuses the thread when the annotated text is clicked", () => {
    comments.rows = [row("c1", "m1", "alpha")];
    const { container } = render(<ReadView markIds={["m1"]} />);

    fireEvent.click(container.querySelector('[data-comment-id="m1"]')!);
    expect(container.querySelector('[data-mark-id="m1"]')?.className).toContain("ring-2");
    expect(container.querySelector('[data-comment-id="m1"]')?.className).toContain(
      "comment-mark--active",
    );
  });

  it("hides a resolved thread until it is asked for", () => {
    comments.rows = [row("c1", "m1", "alpha", { resolvedAt: new Date(2026, 0, 2) })];
    render(<ReadView markIds={["m1"]} />);

    expect(screen.queryByText("c1 body")).toBeNull();
    fireEvent.click(screen.getByText("Aufgelöste (1)"));
    expect(screen.getByText("c1 body")).toBeDefined();
  });

  it("shows inline comments to a viewer but offers no way to answer or resolve", () => {
    comments.rows = [row("c1", "m1", "alpha")];
    render(<ReadView markIds={["m1"]} canComment={false} />);

    expect(screen.getByText("c1 body")).toBeDefined();
    expect(screen.queryByText("Antworten")).toBeNull();
    expect(screen.queryByText("Auflösen")).toBeNull();
  });

  it("renders nothing at all when the page has no inline comments", () => {
    comments.rows = [];
    const { container } = render(<ReadView markIds={[]} />);
    expect(container.querySelector('[aria-label="Inline-Kommentare"]')).toBeNull();
  });
});
