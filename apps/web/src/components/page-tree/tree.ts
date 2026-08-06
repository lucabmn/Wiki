// Pure tree helpers for the sidebar page tree — deliberately free of React and
// @dnd-kit so the drag math (the risky part) is unit-testable in isolation.
//
// The move API positions a page with `parentId` + an optional sibling anchor
// (`beforeId`/`afterId`, fractional LexoRank). These helpers turn a drag gesture
// over a flattened tree into exactly that shape.

export type PageNode = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
};

export type FlatItem = {
  id: string;
  parentId: string | null;
  depth: number;
  title: string;
  icon: string | null;
  hasChildren: boolean;
};

export type Projection = { depth: number; parentId: string | null };
export type MoveArgs = { id: string; parentId: string | null; beforeId?: string; afterId?: string };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Local arrayMove (avoids importing @dnd-kit into pure logic). */
function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const next = array.slice();
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Children of `parentId`, in encounter (position) order. */
function childrenOf(pages: PageNode[], parentId: string | null): PageNode[] {
  return pages.filter((p) => p.parentId === parentId);
}

/**
 * Flattens the page tree into a visible, pre-order list with depth. Descendants
 * of a collapsed node are omitted, but a node's `hasChildren` still reflects the
 * full tree so the collapse chevron shows.
 */
export function buildFlatTree(pages: PageNode[], collapsed: Set<string>): FlatItem[] {
  const out: FlatItem[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf(pages, parentId)) {
      const kids = childrenOf(pages, node.id);
      out.push({
        id: node.id,
        parentId: node.parentId,
        depth,
        title: node.title,
        icon: node.icon,
        hasChildren: kids.length > 0,
      });
      if (kids.length && !collapsed.has(node.id)) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** All descendant ids of `id` (so a dragged node's own subtree is excluded). */
export function descendantIds(pages: PageNode[], id: string): Set<string> {
  const ids = new Set<string>();
  const walk = (parentId: string) => {
    for (const child of childrenOf(pages, parentId)) {
      ids.add(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return ids;
}

/**
 * Given the flattened list and a drag from `activeId` to just above `overId`
 * with a horizontal `offsetLeft` (px), projects the drop depth and resolves the
 * parent it implies — clamped so the result is always a legal position (can't be
 * deeper than one below the item above, nor shallower than the item below).
 */
export function getProjection(
  items: FlatItem[],
  activeId: string,
  overId: string,
  offsetLeft: number,
  indentWidth: number,
): Projection {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const prevItem = newItems[overIndex - 1];
  const nextItem = newItems[overIndex + 1];

  const dragDepth = Math.round(offsetLeft / indentWidth);
  const projectedDepth = (activeItem?.depth ?? 0) + dragDepth;
  const maxDepth = prevItem ? prevItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  const depth = clamp(projectedDepth, minDepth, maxDepth);

  const parentId = (() => {
    if (depth === 0 || !prevItem) return null;
    if (depth === prevItem.depth) return prevItem.parentId;
    if (depth > prevItem.depth) return prevItem.id;
    // Shallower than prevItem: inherit the parent of the nearest earlier item at
    // this depth.
    const ancestor = newItems
      .slice(0, overIndex)
      .reverse()
      .find((i) => i.depth === depth);
    return ancestor?.parentId ?? null;
  })();

  return { depth, parentId };
}

/**
 * Resolves the sibling anchor for `pages.move`: after the drop, the dragged page
 * follows its nearest preceding sibling (`afterId`), or precedes its nearest
 * following sibling (`beforeId`) when it lands first, or neither when it becomes
 * the only child (server appends).
 */
export function getMoveArgs(
  items: FlatItem[],
  activeId: string,
  overId: string,
  projection: Projection,
): MoveArgs {
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const overIndex = items.findIndex((i) => i.id === overId);
  const reordered = arrayMove(items, activeIndex, overIndex).map((item) =>
    item.id === activeId
      ? { ...item, parentId: projection.parentId, depth: projection.depth }
      : item,
  );
  const position = reordered.findIndex((i) => i.id === activeId);

  let afterId: string | undefined;
  for (let i = position - 1; i >= 0; i--) {
    const item = reordered[i];
    if (item && item.parentId === projection.parentId) {
      afterId = item.id;
      break;
    }
  }
  if (afterId) return { id: activeId, parentId: projection.parentId, afterId };

  let beforeId: string | undefined;
  for (let i = position + 1; i < reordered.length; i++) {
    const item = reordered[i];
    if (item && item.parentId === projection.parentId) {
      beforeId = item.id;
      break;
    }
  }
  if (beforeId) return { id: activeId, parentId: projection.parentId, beforeId };

  return { id: activeId, parentId: projection.parentId };
}

// ── Keyboard reordering ──────────────────────────────────────────────────────
//
// Dragging is a pointer gesture: it is unusable with a keyboard, a screen
// reader, or a switch device, and awkward on a touchscreen. These four moves are
// the same operations expressed as discrete steps, so the tree can be
// rearranged from the keyboard or from a menu.
//
// Each returns the `pages.move` arguments, or `null` when the move is not
// possible from where the page currently sits (already first, already at the
// root, …) — which is also what the UI uses to disable the affordance rather
// than letting somebody press a key that silently does nothing.

/** Where `id` sits among its siblings, in position order. */
function siblingContext(
  pages: PageNode[],
  id: string,
): { siblings: PageNode[]; index: number; node: PageNode } | null {
  const node = pages.find((p) => p.id === id);
  if (!node) return null;
  const siblings = childrenOf(pages, node.parentId);
  const index = siblings.findIndex((p) => p.id === id);
  return index < 0 ? null : { siblings, index, node };
}

/** Swap with the previous sibling. Depth is unchanged. */
export function moveUp(pages: PageNode[], id: string): MoveArgs | null {
  const context = siblingContext(pages, id);
  if (!context || context.index === 0) return null;
  const previous = context.siblings[context.index - 1];
  if (!previous) return null;
  return { id, parentId: context.node.parentId, beforeId: previous.id };
}

/** Swap with the next sibling. Depth is unchanged. */
export function moveDown(pages: PageNode[], id: string): MoveArgs | null {
  const context = siblingContext(pages, id);
  if (!context || context.index >= context.siblings.length - 1) return null;
  const next = context.siblings[context.index + 1];
  if (!next) return null;
  return { id, parentId: context.node.parentId, afterId: next.id };
}

/**
 * Nest under the previous sibling, as its last child.
 *
 * The previous *sibling* rather than the previous visible row: that is what
 * keeps the operation reversible with `outdent`, and it is the rule every
 * outliner uses. Impossible for a first child, which has nothing to nest under.
 */
export function indent(pages: PageNode[], id: string): MoveArgs | null {
  const context = siblingContext(pages, id);
  if (!context || context.index === 0) return null;
  const previous = context.siblings[context.index - 1];
  if (!previous) return null;
  const lastChild = childrenOf(pages, previous.id).at(-1);
  // No anchor when the new parent has no children yet — the server appends.
  return lastChild
    ? { id, parentId: previous.id, afterId: lastChild.id }
    : { id, parentId: previous.id };
}

/**
 * Lift out to the grandparent, immediately after the old parent.
 *
 * "After the old parent" rather than appended: the page keeps its place in the
 * reading order, which is where the person expects to still find it.
 */
export function outdent(pages: PageNode[], id: string): MoveArgs | null {
  const node = pages.find((p) => p.id === id);
  if (!node?.parentId) return null;
  const parent = pages.find((p) => p.id === node.parentId);
  if (!parent) return null;
  return { id, parentId: parent.parentId, afterId: parent.id };
}

export type KeyboardMove = "up" | "down" | "indent" | "outdent";

/** The four moves, so the UI can ask once which are available for a page. */
export function keyboardMove(pages: PageNode[], id: string, move: KeyboardMove): MoveArgs | null {
  switch (move) {
    case "up":
      return moveUp(pages, id);
    case "down":
      return moveDown(pages, id);
    case "indent":
      return indent(pages, id);
    case "outdent":
      return outdent(pages, id);
  }
}
