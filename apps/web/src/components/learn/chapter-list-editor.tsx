import { LESSON_KINDS, toastLearnError } from "@/components/learn/lesson-editor";
import { QueryError } from "@/components/query-error";
import { LESSON_KIND_LABEL } from "@/lib/learn-labels";
import { useInvalidate } from "@/lib/query";
import { orpc } from "@/utils/orpc";
import type { LessonKind } from "@nilovon-wiki/api/schemas/lesson";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nilovon-wiki/ui/components/dropdown-menu";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Switch } from "@nilovon-wiki/ui/components/switch";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, FileText, FolderPlus, GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The curriculum: chapters, their lessons, and the ordering of both.
 *
 * Ordering is fractional on the server — `move` takes the id of the row the
 * moved one should follow, and an explicit null means "to the very front" — so
 * a drop is translated into that anchor here rather than into an index. That is
 * also why the list is mirrored into local state: the drop is applied
 * optimistically, the mutation sends one anchor, and the query's next result
 * reseeds the mirror. The server stays the authority on order.
 */

type LessonNode = {
  id: string;
  title: string;
  kind: LessonKind;
  published: boolean;
};

type ChapterNode = {
  id: string;
  title: string;
  published: boolean;
  lessons: LessonNode[];
};

/** Droppable id for a chapter's lesson list, so an empty chapter can receive a drop. */
const dropZoneId = (chapterId: string) => `chapter-drop:${chapterId}`;

export function ChapterListEditor({
  courseId,
  canAuthor,
  selectedLessonId,
  onSelectLesson,
}: {
  courseId: string;
  canAuthor: boolean;
  selectedLessonId: string | null;
  onSelectLesson: (lessonId: string) => void;
}) {
  const outline = useQuery(orpc.learn.lessons.outline.queryOptions({ input: { courseId } }));
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  // A reorder changes visual order and nothing else, which a screen reader is
  // told nothing about by default.
  const [announcement, setAnnouncement] = useState("");

  // The mirror follows the server: every mutation invalidates the outline, and
  // the fresh result replaces whatever the optimistic drop left behind.
  useEffect(() => {
    if (!outline.data) return;
    setChapters(
      outline.data.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        published: chapter.published,
        lessons: chapter.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          kind: lesson.kind,
          published: lesson.published,
        })),
      })),
    );
  }, [outline.data]);

  const invalidateOutline = useInvalidate(orpc.learn.lessons.key());
  const invalidateChapters = useInvalidate(orpc.learn.chapters.key());
  const refresh = () => {
    invalidateOutline();
    invalidateChapters();
  };
  const mutationOptions = { onSuccess: refresh, onError: toastLearnError };

  const createChapter = useMutation(orpc.learn.chapters.create.mutationOptions(mutationOptions));
  const updateChapter = useMutation(orpc.learn.chapters.update.mutationOptions(mutationOptions));
  const deleteChapter = useMutation(orpc.learn.chapters.delete.mutationOptions(mutationOptions));
  const moveChapter = useMutation(orpc.learn.chapters.move.mutationOptions(mutationOptions));
  const createLesson = useMutation(
    orpc.learn.lessons.create.mutationOptions({
      onSuccess: (lesson) => {
        refresh();
        onSelectLesson(lesson.id);
      },
      onError: toastLearnError,
    }),
  );
  const publishLesson = useMutation(orpc.learn.lessons.publish.mutationOptions(mutationOptions));
  const deleteLesson = useMutation(orpc.learn.lessons.delete.mutationOptions(mutationOptions));
  const moveLesson = useMutation(orpc.learn.lessons.move.mutationOptions(mutationOptions));

  const sensors = useSensors(
    // A short distance keeps a plain click on a lesson row selecting it rather
    // than starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Dragging is a pointer gesture; this is what makes the same reorder
    // reachable from the keyboard (space to lift, arrows to move, space to drop).
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Which chapter a drop target belongs to — the zone, the chapter, or a lesson's. */
  const resolveChapterId = (overId: string): string | null => {
    if (overId.startsWith("chapter-drop:")) return overId.slice("chapter-drop:".length);
    if (chapters.some((chapter) => chapter.id === overId)) return overId;
    return chapters.find((chapter) => chapter.lessons.some((l) => l.id === overId))?.id ?? null;
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    if (active.data.current?.type === "chapter") {
      const targetChapterId = resolveChapterId(overId);
      if (!targetChapterId || targetChapterId === activeId) return;
      const from = chapters.findIndex((chapter) => chapter.id === activeId);
      const to = chapters.findIndex((chapter) => chapter.id === targetChapterId);
      if (from === -1 || to === -1) return;

      const next = arrayMove(chapters, from, to);
      setChapters(next);
      const index = next.findIndex((chapter) => chapter.id === activeId);
      moveChapter.mutate({
        id: activeId,
        // The anchor is the row that ends up before it; null is "to the front".
        afterChapterId: index > 0 ? next[index - 1]!.id : null,
      });
      setAnnouncement(`Kapitel an Position ${index + 1} verschoben.`);
      return;
    }

    const source = chapters.find((chapter) => chapter.lessons.some((l) => l.id === activeId));
    const targetChapterId = resolveChapterId(overId);
    if (!source || !targetChapterId) return;
    const target = chapters.find((chapter) => chapter.id === targetChapterId);
    if (!target) return;

    let nextTargetLessons: LessonNode[];
    if (source.id === target.id) {
      const from = source.lessons.findIndex((lesson) => lesson.id === activeId);
      const overIndex = source.lessons.findIndex((lesson) => lesson.id === overId);
      // Dropped on the chapter itself rather than on a sibling: park it last.
      const to = overIndex === -1 ? source.lessons.length - 1 : overIndex;
      if (from === to) return;
      nextTargetLessons = arrayMove(source.lessons, from, to);
    } else {
      const moved = source.lessons.find((lesson) => lesson.id === activeId)!;
      const overIndex = target.lessons.findIndex((lesson) => lesson.id === overId);
      const insertAt = overIndex === -1 ? target.lessons.length : overIndex;
      nextTargetLessons = [
        ...target.lessons.slice(0, insertAt),
        moved,
        ...target.lessons.slice(insertAt),
      ];
    }

    const index = nextTargetLessons.findIndex((lesson) => lesson.id === activeId);
    setChapters((current) =>
      current.map((chapter) => {
        if (chapter.id === target.id) return { ...chapter, lessons: nextTargetLessons };
        if (chapter.id === source.id) {
          return {
            ...chapter,
            lessons: chapter.lessons.filter((lesson) => lesson.id !== activeId),
          };
        }
        return chapter;
      }),
    );
    moveLesson.mutate({
      id: activeId,
      // Always sent: a move between chapters needs it, and within one it is the
      // lesson's own chapter, so there is no case where omitting it is clearer.
      chapterId: target.id,
      afterLessonId: index > 0 ? nextTargetLessons[index - 1]!.id : null,
    });
    setAnnouncement(`Lektion nach „${target.title}“ an Position ${index + 1} verschoben.`);
  };

  if (outline.isError) {
    return <QueryError compact error={outline.error} onRetry={() => void outline.refetch()} />;
  }
  if (outline.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const list = (
    <div className="space-y-3">
      {chapters.map((chapter) => (
        <ChapterCard
          key={chapter.id}
          chapter={chapter}
          canAuthor={canAuthor}
          dragging={dragging === chapter.id}
          selectedLessonId={selectedLessonId}
          onSelectLesson={onSelectLesson}
          onRename={(title) => updateChapter.mutate({ id: chapter.id, title })}
          onPublishedChange={(published) => updateChapter.mutate({ id: chapter.id, published })}
          onDelete={() => {
            if (
              window.confirm(
                `Kapitel „${chapter.title}“ mit allen darin enthaltenen Lektionen löschen?`,
              )
            ) {
              deleteChapter.mutate({ id: chapter.id });
            }
          }}
          onAddLesson={(kind) =>
            createLesson.mutate({
              chapterId: chapter.id,
              kind,
              title: `Neue Lektion (${LESSON_KIND_LABEL[kind]})`,
            })
          }
          onPublishLesson={(lessonId, published) =>
            publishLesson.mutate({ id: lessonId, published })
          }
          onDeleteLesson={(lesson) => {
            if (window.confirm(`Lektion „${lesson.title}“ löschen?`)) {
              deleteLesson.mutate({ id: lesson.id });
            }
          }}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {chapters.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Dieser Kurs hat noch keine Kapitel. Lege eines an, um Lektionen hinzuzufügen.
        </p>
      ) : canAuthor ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Mit der Leertaste aufnehmen, mit den Pfeiltasten verschieben, mit der Leertaste ablegen, mit Escape abbrechen.",
            },
          }}
          onDragStart={({ active }: DragStartEvent) => setDragging(String(active.id))}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={chapters.map((chapter) => chapter.id)}
            strategy={verticalListSortingStrategy}
          >
            {list}
          </SortableContext>
        </DndContext>
      ) : (
        list
      )}

      {canAuthor ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={createChapter.isPending}
          onClick={() =>
            createChapter.mutate({
              courseId,
              // No `afterChapterId`: omitted means append, and an explicit null
              // would put every new chapter at the top of the course.
              title: `Kapitel ${chapters.length + 1}`,
            })
          }
        >
          <FolderPlus className="size-4" aria-hidden />
          Kapitel hinzufügen
        </Button>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function ChapterCard({
  chapter,
  canAuthor,
  dragging,
  selectedLessonId,
  onSelectLesson,
  onRename,
  onPublishedChange,
  onDelete,
  onAddLesson,
  onPublishLesson,
  onDeleteLesson,
}: {
  chapter: ChapterNode;
  canAuthor: boolean;
  dragging: boolean;
  selectedLessonId: string | null;
  onSelectLesson: (lessonId: string) => void;
  onRename: (title: string) => void;
  onPublishedChange: (published: boolean) => void;
  onDelete: () => void;
  onAddLesson: (kind: LessonKind) => void;
  onPublishLesson: (lessonId: string, published: boolean) => void;
  onDeleteLesson: (lesson: LessonNode) => void;
}) {
  const sortable = useSortable({
    id: chapter.id,
    disabled: !canAuthor,
    data: { type: "chapter" },
  });
  const dropZone = useDroppable({ id: dropZoneId(chapter.id), data: { type: "chapter-zone" } });
  const [title, setTitle] = useState(chapter.title);

  // The card, not the handle, is the drop target — but the *listeners* sit on
  // the handle alone, or the rename field below would never see a click.
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  const commitRename = () => {
    const value = title.trim();
    if (!value) {
      setTitle(chapter.title);
      return;
    }
    if (value !== chapter.title) onRename(value);
  };

  return (
    <Card
      ref={sortable.setNodeRef}
      style={style}
      className={cn("space-y-2 p-2", dragging && "opacity-50")}
    >
      <div className="flex items-center gap-1">
        {canAuthor ? (
          <button
            type="button"
            aria-label={`Kapitel „${chapter.title}“ verschieben`}
            className="text-muted-foreground hover:text-foreground flex size-7 shrink-0 cursor-grab items-center justify-center rounded active:cursor-grabbing"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}

        <Input
          value={title}
          aria-label="Kapiteltitel"
          disabled={!canAuthor}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") setTitle(chapter.title);
          }}
          className="h-8 border-transparent bg-transparent font-medium shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
        />

        {canAuthor ? (
          <>
            <Switch
              size="sm"
              className="mx-1 shrink-0"
              checked={chapter.published}
              aria-label={`Kapitel „${chapter.title}“ veröffentlichen`}
              onCheckedChange={(next) => onPublishedChange(Boolean(next))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Kapitel „${chapter.title}“ löschen`}
              onClick={onDelete}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </>
        ) : null}
      </div>

      <div ref={dropZone.setNodeRef} className="min-h-8 space-y-0.5 pl-6">
        <SortableContext
          items={chapter.lessons.map((lesson) => lesson.id)}
          strategy={verticalListSortingStrategy}
        >
          {chapter.lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              chapterId={chapter.id}
              canAuthor={canAuthor}
              active={selectedLessonId === lesson.id}
              onSelect={() => onSelectLesson(lesson.id)}
              onTogglePublished={() => onPublishLesson(lesson.id, !lesson.published)}
              onDelete={() => onDeleteLesson(lesson)}
            />
          ))}
        </SortableContext>

        {chapter.lessons.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1 text-xs">Noch keine Lektionen</p>
        ) : null}
      </div>

      {canAuthor ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size="sm" className="ml-6">
                <Plus className="size-4" aria-hidden />
                Lektion hinzufügen
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Art der Lektion</DropdownMenuLabel>
            {LESSON_KINDS.map((kind) => (
              <DropdownMenuItem key={kind} onClick={() => onAddLesson(kind)}>
                {LESSON_KIND_LABEL[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </Card>
  );
}

function LessonRow({
  lesson,
  chapterId,
  canAuthor,
  active,
  onSelect,
  onTogglePublished,
  onDelete,
}: {
  lesson: LessonNode;
  chapterId: string;
  canAuthor: boolean;
  active: boolean;
  onSelect: () => void;
  onTogglePublished: () => void;
  onDelete: () => void;
}) {
  const sortable = useSortable({
    id: lesson.id,
    disabled: !canAuthor,
    // `chapterId` travels with the row so a cross-chapter drop knows where the
    // lesson came from without searching the whole outline.
    data: { type: "lesson", chapterId },
  });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        "group/lesson-row flex items-center gap-0.5",
        sortable.isDragging && "opacity-50",
      )}
    >
      {canAuthor ? (
        <button
          type="button"
          aria-label={`Lektion „${lesson.title}“ verschieben`}
          className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 cursor-grab items-center justify-center rounded active:cursor-grabbing"
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
          active ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent",
        )}
      >
        <FileText className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{lesson.title}</span>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
          {LESSON_KIND_LABEL[lesson.kind]}
        </span>
      </button>

      {canAuthor ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              lesson.published
                ? `Lektion „${lesson.title}“ zurückziehen`
                : `Lektion „${lesson.title}“ veröffentlichen`
            }
            title={lesson.published ? "Veröffentlicht" : "Entwurf"}
            onClick={onTogglePublished}
          >
            {lesson.published ? (
              <Eye className="size-3.5" aria-hidden />
            ) : (
              <EyeOff className="size-3.5 opacity-60" aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Lektion „${lesson.title}“ löschen`}
            // Visible on hover and whenever it has focus — a control that only
            // appears on hover is invisible to the keyboard.
            className="opacity-0 focus-visible:opacity-100 group-hover/lesson-row:opacity-100"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </>
      ) : null}
    </div>
  );
}
