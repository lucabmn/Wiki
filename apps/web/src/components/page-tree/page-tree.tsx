import { QueryError } from "@/components/query-error";
import { toastError, useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { Page } from "@nilovon-wiki/api/schemas/page";
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
import { ChevronRight, FileText } from "lucide-react";
import { useMemo, useState } from "react";

import {
  buildFlatTree,
  descendantIds,
  type FlatItem,
  getMoveArgs,
  getProjection,
  type PageNode,
  type Projection,
} from "./tree";

const INDENT = 16;

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
  } = useQuery(orpc.pages.list.queryOptions({ input: { spaceId } }));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);

  const invalidate = useInvalidate(orpc.pages.list.key());
  const move = useMutation(orpc.pages.move.mutationOptions());

  const nodes: PageNode[] = useMemo(
    () =>
      (pages ?? []).map((p: Page) => ({
        id: p.id,
        parentId: p.parentId,
        title: p.title,
        icon: p.icon,
      })),
    [pages],
  );

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
      move.mutate(args, { onError: toastError, onSuccess: invalidate });
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
      onToggle={() => toggle(item.id)}
      onSelect={() => onSelectPage(item.id)}
    />
  ));

  if (!canReorder) {
    return <div className="py-0.5">{rows}</div>;
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
    </DndContext>
  );
}

function PageTreeRow({
  item,
  depth,
  collapsed,
  isActive,
  draggable,
  onToggle,
  onSelect,
}: {
  item: FlatItem;
  depth: number;
  collapsed: boolean;
  isActive: boolean;
  draggable: boolean;
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
      className={cn("flex items-center", sortable.isDragging && "opacity-50")}
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
    </div>
  );
}
