import { describe, expect, it } from "vitest";

import {
  buildFlatTree,
  descendantIds,
  getMoveArgs,
  getProjection,
  type PageNode,
} from "@/components/page-tree/tree";

const node = (id: string, parentId: string | null): PageNode => ({
  id,
  parentId,
  title: id,
  icon: null,
});

// a ─ a1, a2   b ─ b1
const tree: PageNode[] = [
  node("a", null),
  node("a1", "a"),
  node("a2", "a"),
  node("b", null),
  node("b1", "b"),
];

// Three flat root pages, for clear reorder/nest assertions.
const flat: PageNode[] = [node("p1", null), node("p2", null), node("p3", null)];
const INDENT = 24;

describe("buildFlatTree", () => {
  it("flattens in pre-order with depth and hasChildren", () => {
    const items = buildFlatTree(tree, new Set());
    expect(items.map((i) => [i.id, i.depth, i.hasChildren])).toEqual([
      ["a", 0, true],
      ["a1", 1, false],
      ["a2", 1, false],
      ["b", 0, true],
      ["b1", 1, false],
    ]);
  });

  it("hides descendants of collapsed nodes but keeps the chevron flag", () => {
    const items = buildFlatTree(tree, new Set(["a"]));
    expect(items.map((i) => i.id)).toEqual(["a", "b", "b1"]);
    expect(items.find((i) => i.id === "a")?.hasChildren).toBe(true);
  });
});

describe("descendantIds", () => {
  it("collects the whole subtree", () => {
    expect(descendantIds(tree, "a")).toEqual(new Set(["a1", "a2"]));
    expect(descendantIds(tree, "b")).toEqual(new Set(["b1"]));
    expect(descendantIds(tree, "a1")).toEqual(new Set());
  });
});

describe("getProjection + getMoveArgs", () => {
  it("reorders within the same parent (drop to top → before first)", () => {
    const items = buildFlatTree(flat, new Set());
    const projection = getProjection(items, "p3", "p1", 0, INDENT);
    expect(projection).toEqual({ depth: 0, parentId: null });
    expect(getMoveArgs(items, "p3", "p1", projection)).toEqual({
      id: "p3",
      parentId: null,
      beforeId: "p1",
    });
  });

  it("nests under the item above when dragged one level right", () => {
    const items = buildFlatTree(flat, new Set());
    // Drop p3 between p1 and p2 with a one-level indent → child of p1.
    const projection = getProjection(items, "p3", "p2", INDENT, INDENT);
    expect(projection).toEqual({ depth: 1, parentId: "p1" });
    expect(getMoveArgs(items, "p3", "p2", projection)).toEqual({
      id: "p3",
      parentId: "p1",
    });
  });

  it("clamps depth so a drop can't skip levels", () => {
    const items = buildFlatTree(flat, new Set());
    // Huge offset would imply depth 5, but max is one below the item above.
    const projection = getProjection(items, "p3", "p2", INDENT * 5, INDENT);
    expect(projection.depth).toBe(1);
    expect(projection.parentId).toBe("p1");
  });

  it("moves an existing child out to root", () => {
    const items = buildFlatTree(tree, new Set());
    // Drag a2 to just below b at root depth (offset back to 0).
    const projection = getProjection(items, "a2", "b1", 0, INDENT);
    expect(projection.parentId).toBe("b");
    // Anchored to b1 (its new preceding sibling under b).
    const args = getMoveArgs(items, "a2", "b1", projection);
    expect(args.parentId).toBe("b");
  });
});
