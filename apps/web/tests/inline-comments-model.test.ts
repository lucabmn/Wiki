import { describe, expect, it } from "vitest";

import { createCommentAnchor } from "@nilovon-wiki/editor/comment-anchor";
import { buildInlineThreads, splitComments, type CommentRow } from "@/lib/inline-comments";

let clock = 0;
function comment(overrides: Partial<CommentRow> & { id: string }): CommentRow {
  clock += 1000;
  return {
    parentId: null,
    authorId: "u1",
    body: "body",
    anchor: null,
    resolvedAt: null,
    createdAt: new Date(clock),
    ...overrides,
  };
}

const anchored = (id: string, markId: string, excerpt = markId) =>
  comment({ id, anchor: createCommentAnchor(markId, excerpt) });

describe("splitComments", () => {
  it("keeps page-wide comments and their replies out of the rail", () => {
    const root = comment({ id: "c1" });
    const reply = comment({ id: "c2", parentId: "c1" });
    const { inline, page } = splitComments([root, reply]);
    expect(inline).toEqual([]);
    expect(page.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("counts a reply to an inline comment as inline", () => {
    const root = anchored("c1", "m1");
    const reply = comment({ id: "c2", parentId: "c1" });
    const nested = comment({ id: "c3", parentId: "c2" });
    const { inline, page } = splitComments([root, reply, nested]);
    expect(inline.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(page).toEqual([]);
  });
});

describe("buildInlineThreads", () => {
  it("orders threads by position in the document, not by creation time", () => {
    const late = anchored("c1", "top");
    const early = anchored("c2", "bottom");
    const threads = buildInlineThreads(
      [late, early],
      new Map([
        ["top", 400],
        ["bottom", 40],
      ]),
    );
    expect(threads.map((t) => t.markId)).toEqual(["bottom", "top"]);
  });

  it("keeps two overlapping anchors as two threads, oldest first", () => {
    const first = anchored("c1", "m1");
    const second = anchored("c2", "m2");
    const threads = buildInlineThreads(
      [second, first],
      new Map([
        ["m1", 120],
        ["m2", 120],
      ]),
    );
    expect(threads.map((t) => t.markId)).toEqual(["m1", "m2"]);
    expect(threads.every((t) => !t.orphaned)).toBe(true);
  });

  it("marks a thread whose anchor is gone as orphaned and sorts it last", () => {
    const gone = anchored("c1", "gone", "the deleted sentence");
    const present = anchored("c2", "here");
    const threads = buildInlineThreads([gone, present], new Map([["here", 900]]));

    expect(threads.map((t) => t.markId)).toEqual(["here", "gone"]);
    const orphan = threads[1]!;
    expect(orphan.orphaned).toBe(true);
    // The comment does not disappear, and it does not move to a random place:
    // it keeps the text it was originally made on.
    expect(orphan.anchor.excerpt).toBe("the deleted sentence");
    expect(orphan.root.body).toBe("body");
  });

  it("threads replies under their root, oldest first", () => {
    const root = anchored("c1", "m1");
    const first = comment({ id: "c2", parentId: "c1", body: "first" });
    const second = comment({ id: "c3", parentId: "c1", body: "second" });
    const [thread] = buildInlineThreads([root, second, first], new Map([["m1", 10]]));
    expect(thread?.replies.map((r) => r.body)).toEqual(["first", "second"]);
  });

  it("reports a resolved root so the rail can hide the thread", () => {
    const root = { ...anchored("c1", "m1"), resolvedAt: new Date() };
    const [thread] = buildInlineThreads([root], new Map([["m1", 10]]));
    expect(thread?.resolved).toBe(true);
  });

  it("ignores a comment whose anchor cannot be read", () => {
    const broken = comment({ id: "c1", anchor: { v: 99, markId: "m1" } });
    expect(buildInlineThreads([broken], new Map())).toEqual([]);
  });
});
