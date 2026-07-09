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
