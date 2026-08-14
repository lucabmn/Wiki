import { QueryError } from "@/components/query-error";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { PageTreeNode } from "@nilovon-wiki/api/schemas/page";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  FileText,
  MoreHorizontal,
  ArrowDown,
  ArrowUp,
  IndentIncrease,
  IndentDecrease,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@nilovon-wiki/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";

import {
  buildFlatTree,
  descendantIds,
  type FlatItem,
  getMoveArgs,
  getProjection,
  keyboardMove,
  type KeyboardMove,
  type PageNode,
  type Projection,
} from "./tree";

const INDENT = 16;

/**
 * The keyboard and menu alternative to dragging.
 *
 * Dragging is a pointer gesture — unusable with a keyboard, a screen reader or a
 * switch device, and awkward on a touchscreen. Each entry is offered both as a
 * menu item and as a shortcut on the focused row, and disabled when the move is
 * impossible from where the page sits, so nobody presses a key that silently
 * does nothing.
 */
const MOVES: ReadonlyArray<{
  move: KeyboardMove;
  label: string;
  hint: string;
  icon: typeof ArrowUp;
  /** Announced after the move, for the live region. */
  announce: string;
}> = [
  { move: "up", label: "Nach oben", hint: "Alt + ↑", icon: ArrowUp, announce: "nach oben" },
  { move: "down", label: "Nach unten", hint: "Alt + ↓", icon: ArrowDown, announce: "nach unten" },
  {
    move: "indent",
    label: "Einrücken",
    hint: "Alt + →",
    icon: IndentIncrease,
    announce: "eingerückt",
  },
  {
    move: "outdent",
    label: "Ausrücken",
    hint: "Alt + ←",
    icon: IndentDecrease,
    announce: "ausgerückt",
  },
];

/** Alt + arrow, the convention every outliner uses. */
const SHORTCUTS: Record<string, KeyboardMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowRight: "indent",
  ArrowLeft: "outdent",
};

/**
 * Nested, collapsible page tree with drag-to-reorder and drag-to-nest. Loads
 * every page in the space once and builds the tree client-side; a drop is
 * translated (in ./tree) into a single `pages.move` call with the right parent
 * and sibling anchor. When the user lacks `page: ["move"]`, the same tree renders
 * without drag handles.
 */
export function PageTree({
  spaceId,
  activePage,
  canReorder,
  onSelectPage,
}: {
  spaceId: string;
  activePage: string | null;
  canReorder: boolean;
  onSelectPage: (id: string) => void;
}) {
  const {
    data: pages,
    isPending,
    isError,
    error,
    refetch,
    // `pages.tree`, not `pages.list`: the tree needs titles, and `list` carries
    // every page's whole document body with them.
  } = useQuery(orpc.pages.tree.queryOptions({ input: { spaceId } }));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  // A reorder changes the visual order and nothing else, so a screen reader is
  // told nothing by default. This is the only feedback a non-sighted person
  // gets that the move happened at all.
  const [announcement, setAnnouncement] = useState("");

  // The whole `pages` router rather than just the tree: a move changes both the
  // tree and any cached page list, and the two drifting apart shows up as a
  // sidebar that disagrees with the page next to it.
  const invalidate = useInvalidate(orpc.pages.key());
  // Named for what it does, not for the parameter it shares a word with:
  // `move` is also the name of a keyboard-move argument below.
  const movePage = useMutation(orpc.pages.move.mutationOptions());

  const nodes: PageNode[] = useMemo(
    () =>
      (pages ?? []).map((p: PageTreeNode) => ({
        id: p.id,
        parentId: p.parentId,
        title: p.title,
        icon: p.icon,
      })),
    [pages],
  );

  /** Runs one keyboard/menu move, or announces that it was not possible. */
  const runMove = (id: string, move: KeyboardMove) => {
    const entry = MOVES.find((candidate) => candidate.move === move);
    const args = keyboardMove(nodes, id, move);
    const title = nodes.find((node) => node.id === id)?.title ?? "Seite";
    if (!args) {
      setAnnouncement(`${title} kann nicht ${entry?.announce ?? "verschoben"} werden.`);
      return;
    }
    movePage.mutate(args, {
      onError: toastError,
      onSuccess: () => {
        invalidate();
        setAnnouncement(`${title} ${entry?.announce ?? "verschoben"}.`);
      },
    });
  };

  // While dragging, hide the active node's own subtree so it can't nest in
  // itself and the drop targets stay stable.
  const items = useMemo(() => {
    const flat = buildFlatTree(nodes, collapsed);
    if (!activeId) return flat;
    const subtree = descendantIds(nodes, activeId);
    return flat.filter((item) => !subtree.has(item.id));
  }, [nodes, collapsed, activeId]);

  const projection: Projection | null =
    activeId && overId ? getProjection(items, activeId, overId, offsetLeft, INDENT) : null;

  const sensors = useSensors(
    // A small activation distance lets a plain click select the page instead of
    // starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reset = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetLeft(0);
  };

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));
  const onDragMove = ({ delta }: DragMoveEvent) => setOffsetLeft(delta.x);
  const onDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && projection) {
      const args = getMoveArgs(items, String(active.id), String(over.id), projection);
      movePage.mutate(args, { onError: toastError, onSuccess: invalidate });
    }
    reset();
  };

  if (isPending) {
    return (
      <div className="space-y-1 py-1">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mx-2 h-6 w-40" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <QueryError compact error={error} onRetry={() => refetch()} />;
  }

  if (!items.length) {
    return <p className="px-2 py-1 text-[12px] text-muted-foreground">Keine Seiten</p>;
  }

  const rows = items.map((item) => (
    <PageTreeRow
      key={item.id}
      item={item}
      depth={item.id === activeId && projection ? projection.depth : item.depth}
      collapsed={collapsed.has(item.id)}
      isActive={activePage === item.id}
      draggable={canReorder}
      canReorder={canReorder}
      availableMoves={
        canReorder
          ? MOVES.filter((entry) => keyboardMove(nodes, item.id, entry.move) !== null).map(
              (entry) => entry.move,
            )
          : []
      }
      onMove={(move) => runMove(item.id, move)}
      onToggle={() => toggle(item.id)}
      onSelect={() => onSelectPage(item.id)}
    />
  ));

  // `polite` rather than `assertive`: a reorder is a confirmation, not an
  // interruption. Rendered in both branches so the announcement survives a tree
  // that is not reorderable for this caller.
  const liveRegion = (
    <div aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );

  if (!canReorder) {
    return (
      <div className="py-0.5">
        {rows}
        {liveRegion}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="py-0.5">{rows}</div>
      </SortableContext>
      {liveRegion}
    </DndContext>
  );
}

function PageTreeRow({
  item,
  depth,
  collapsed,
  isActive,
  draggable,
  canReorder,
  availableMoves,
  onMove,
  onToggle,
  onSelect,
}: {
  item: FlatItem;
  depth: number;
  collapsed: boolean;
  isActive: boolean;
  draggable: boolean;
  canReorder: boolean;
  /** Which of the four moves are possible from where this page currently sits. */
  availableMoves: KeyboardMove[];
  onMove: (move: KeyboardMove) => void;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !draggable });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
    paddingLeft: depth * INDENT + 8,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn("group/page-row flex items-center", sortable.isDragging && "opacity-50")}
    >
      {item.hasChildren ? (
        <button
          type="button"
          aria-label={collapsed ? "Ausklappen" : "Einklappen"}
          onClick={onToggle}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
          />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onSelect}
        {...(draggable ? { ...sortable.attributes, ...sortable.listeners } : {})}
        // AFTER the listener spread on purpose: `useSortable` supplies its own
        // `onKeyDown`, and spreading it last silently replaced this handler —
        // the keyboard moves did nothing at all. Chained rather than replaced,
        // so dnd-kit still sees the event.
        onKeyDown={(event) => {
          if (draggable) sortable.listeners?.onKeyDown?.(event);
          // Alt is what keeps these from colliding with the browser's own
          // caret/scroll handling and with the arrow keys people use to move
          // through the tree.
          if (!canReorder || !event.altKey) return;
          const move = SHORTCUTS[event.key];
          if (!move) return;
          event.preventDefault();
          onMove(move);
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent",
          draggable && "cursor-grab active:cursor-grabbing",
          isActive && "bg-primary/10 font-medium text-primary",
        )}
      >
        {item.icon ? (
          <span className="text-sm leading-none">{item.icon}</span>
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{item.title}</span>
      </button>
      {canReorder && (
        // The same four moves as a menu. The keyboard shortcuts above are
        // faster once you know them; this is how you find out they exist, and
        // it is also the path for anyone using a pointer but unable to drag.
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                // Visible on hover and whenever it has focus — a control that
                // only appears on hover is invisible to the keyboard.
                className="size-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover/page-row:opacity-100"
                aria-label={`Seite „${item.title}" verschieben`}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Verschieben</DropdownMenuLabel>
              {MOVES.map((entry) => (
                <DropdownMenuItem
                  key={entry.move}
                  // Disabled rather than hidden: a menu whose items move around
                  // is harder to learn than one where they grey out.
                  disabled={!availableMoves.includes(entry.move)}
                  onClick={() => onMove(entry.move)}
                >
                  <entry.icon className="size-4" />
                  {entry.label}
                  <span className="ml-auto text-xs text-muted-foreground">{entry.hint}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
