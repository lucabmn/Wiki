import { LESSON_KIND_LABEL, LOCK_REASON_LABEL, formatDuration } from "@/lib/learn-labels";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  FileText,
  Film,
  ListChecks,
  Lock,
  MonitorPlay,
  PlayCircle,
  Type,
} from "lucide-react";

type OutlineLesson = {
  id: string;
  title: string;
  kind: string;
  durationSeconds: number | null;
  isRequired: boolean;
  published: boolean;
  status: "not_started" | "in_progress" | "completed";
  locked: boolean;
  lockReason: string;
  availableAt: Date | string | null;
};

type OutlineChapter = {
  id: string;
  title: string;
  description: string | null;
  published: boolean;
  locked: boolean;
  availableAt: Date | string | null;
  lessons: OutlineLesson[];
};

const KIND_ICON: Record<string, typeof Type> = {
  dynamic: Type,
  video: Film,
  embed: MonitorPlay,
  document: FileText,
  assignment: ClipboardList,
  quiz: ListChecks,
};

/**
 * The course outline, shared by the landing page and the player.
 *
 * Locked rows render as text rather than as links, and say *why* they are
 * locked. A greyed-out row with no explanation is the single most common way a
 * drip-released or sequential course reads as broken.
 */
export function CourseOutlineList({
  slug,
  chapters,
  activeLessonId,
  compact = false,
}: {
  slug: string;
  chapters: OutlineChapter[];
  activeLessonId?: string;
  compact?: boolean;
}) {
  return (
    <ol className={cn("space-y-6", compact && "space-y-4")}>
      {chapters.map((chapter, index) => (
        <li key={chapter.id} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className={cn("font-medium", compact ? "text-sm" : "text-base")}>
              {chapter.title}
            </h3>
            {!chapter.published && <Badge variant="outline">Entwurf</Badge>}
            {chapter.locked && chapter.availableAt && (
              <Badge variant="secondary">ab {formatDate(chapter.availableAt)}</Badge>
            )}
          </div>
          {chapter.description && !compact && (
            <p className="text-muted-foreground pl-7 text-sm">{chapter.description}</p>
          )}

          <ul className="space-y-0.5">
            {chapter.lessons.map((lesson) => (
              <li key={lesson.id}>
                <OutlineRow
                  slug={slug}
                  lesson={lesson}
                  active={lesson.id === activeLessonId}
                  compact={compact}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function OutlineRow({
  slug,
  lesson,
  active,
  compact,
}: {
  slug: string;
  lesson: OutlineLesson;
  active: boolean;
  compact: boolean;
}) {
  const Icon = KIND_ICON[lesson.kind] ?? Type;
  const duration = formatDuration(lesson.durationSeconds);

  const body = (
    <>
      <StatusMark lesson={lesson} />
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{lesson.title}</span>
      {!lesson.published && <Badge variant="outline">Entwurf</Badge>}
      {!lesson.isRequired && (
        <Badge variant="secondary" className="hidden sm:inline-flex">
          Optional
        </Badge>
      )}
      <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
        {duration || LESSON_KIND_LABEL[lesson.kind]}
      </span>
    </>
  );

  const shared = cn(
    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm",
    compact && "py-1.5",
    active && "bg-accent text-accent-foreground font-medium",
  );

  if (lesson.locked) {
    const reason = LOCK_REASON_LABEL[lesson.lockReason] || "Noch nicht verfügbar";
    return (
      <div
        className={cn(shared, "text-muted-foreground cursor-not-allowed")}
        title={reason}
        aria-disabled
      >
        {body}
        <span className="sr-only">— {reason}</span>
      </div>
    );
  }

  return (
    <Link
      to="/learn/courses/$slug/lessons/$lessonId"
      params={{ slug, lessonId: lesson.id }}
      className={cn(shared, "hover:bg-accent/60 transition-colors")}
    >
      {body}
    </Link>
  );
}

function StatusMark({ lesson }: { lesson: OutlineLesson }) {
  if (lesson.locked) {
    return <Lock className="text-muted-foreground size-4 shrink-0" aria-label="Gesperrt" />;
  }
  if (lesson.status === "completed") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Abgeschlossen" />;
  }
  if (lesson.status === "in_progress") {
    return <PlayCircle className="text-primary size-4 shrink-0" aria-label="Begonnen" />;
  }
  return <CircleDashed className="text-muted-foreground/60 size-4 shrink-0" aria-label="Offen" />;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
