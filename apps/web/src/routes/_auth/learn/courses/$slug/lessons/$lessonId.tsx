import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CourseOutlineList } from "@/components/learn/course-outline-list";
import { LessonPlayer } from "@/components/learn/lesson-player";
import { useLessonProgress } from "@/components/learn/use-lesson-progress";
import { QueryError } from "@/components/query-error";
import { LESSON_KIND_LABEL, LOCK_REASON_LABEL, formatDuration } from "@/lib/learn-labels";
import { orpc } from "@/utils/orpc";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button, buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, CircleCheck, Lock, UserRoundX } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/_auth/learn/courses/$slug/lessons/$lessonId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { slug, lessonId } = Route.useParams();
  const course = useQuery(orpc.learn.courses.getBySlug.queryOptions({ input: { slug } }));
  const courseId = course.data?.id;

  const outline = useQuery({
    ...orpc.learn.lessons.outline.queryOptions({ input: { courseId: courseId ?? "" } }),
    enabled: Boolean(courseId),
  });
  const lesson = useQuery(orpc.learn.lessons.get.queryOptions({ input: { id: lessonId } }));

  // The outline is the order the course is taught in, so previous/next are read
  // off it rather than off a separate navigation payload.
  const lessons = useMemo(
    () => outline.data?.chapters.flatMap((chapter) => chapter.lessons) ?? [],
    [outline.data],
  );
  const index = lessons.findIndex((row) => row.id === lessonId);
  const entry = index >= 0 ? lessons[index] : undefined;
  const previous = index > 0 ? lessons[index - 1] : undefined;
  const next = index >= 0 ? lessons[index + 1] : undefined;

  const enrollment = course.data?.enrollment ?? null;
  const enrolled = enrollment?.status === "active" || enrollment?.status === "completed";
  const completed = entry?.status === "completed";

  const progress = useLessonProgress({ lessonId, enabled: enrolled });

  if (course.isError) {
    return (
      <DashboardLayout>
        <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <QueryError error={course.error} onRetry={() => void course.refetch()} />
        </div>
      </DashboardLayout>
    );
  }

  if (course.isPending || !course.data) {
    return (
      <DashboardLayout>
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto grid w-full max-w-6xl gap-8 p-4 md:p-6 lg:grid-cols-[20rem_1fr]">
        <nav aria-label="Kursinhalt" className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <h2 className="sr-only">Kursinhalt</h2>
          <Card className="space-y-3 p-4">
            <Link
              to="/learn/courses/$slug"
              params={{ slug }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="truncate">{course.data.title}</span>
            </Link>
            {outline.data && (
              <div className="space-y-1.5">
                <Progress value={outline.data.progressPercent} />
                <p className="text-muted-foreground text-xs">
                  {outline.data.completedLessons} von {outline.data.totalLessons} Lektionen ·{" "}
                  {outline.data.progressPercent} % abgeschlossen
                </p>
              </div>
            )}
          </Card>

          {outline.isPending ? (
            <Skeleton className="h-72 w-full rounded-xl" />
          ) : outline.isError ? (
            <QueryError error={outline.error} onRetry={() => void outline.refetch()} compact />
          ) : outline.data ? (
            <CourseOutlineList
              slug={slug}
              chapters={outline.data.chapters}
              activeLessonId={lessonId}
              compact
            />
          ) : null}
        </nav>

        <div className="min-w-0 space-y-6">
          {lesson.isError ? (
            <LessonUnavailable
              error={lesson.error}
              slug={slug}
              onRetry={() => void lesson.refetch()}
            />
          ) : lesson.isPending || !lesson.data ? (
            <>
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-72 w-full rounded-xl" />
            </>
          ) : (
            <>
              <header className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{LESSON_KIND_LABEL[lesson.data.kind]}</Badge>
                  {!lesson.data.isRequired && <Badge variant="outline">Optional</Badge>}
                  {formatDuration(lesson.data.durationSeconds) && (
                    <span className="text-muted-foreground text-sm">
                      {formatDuration(lesson.data.durationSeconds)}
                    </span>
                  )}
                  {completed && (
                    <Badge>
                      <CircleCheck className="size-3.5" aria-hidden />
                      Abgeschlossen
                    </Badge>
                  )}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  {lesson.data.title}
                </h1>
              </header>

              {!enrolled && (
                <Alert>
                  <UserRoundX aria-hidden />
                  <AlertTitle>Du bist nicht eingeschrieben</AlertTitle>
                  <AlertDescription>
                    Du siehst diese Lektion als Mitglied des Kursteams. Dein Fortschritt wird nicht
                    aufgezeichnet.
                  </AlertDescription>
                </Alert>
              )}

              {/* The outline — not `lessons.get` — decides whether a lesson is
                  open: sequential courses and dripped chapters are resolved
                  there, and the read endpoint only gates enrolment and
                  publication. Honouring it here is what keeps the player from
                  contradicting the rail beside it. */}
              {entry?.locked ? (
                <Alert>
                  <Lock aria-hidden />
                  <AlertTitle>Diese Lektion ist noch gesperrt</AlertTitle>
                  <AlertDescription>
                    {LOCK_REASON_LABEL[entry.lockReason] || "Noch nicht verfügbar"}
                    {entry.availableAt ? ` — ab ${formatDate(entry.availableAt)}` : ""}
                  </AlertDescription>
                </Alert>
              ) : (
                <LessonPlayer
                  lesson={lesson.data}
                  courseId={course.data.id}
                  resumeAtSeconds={entry?.positionSeconds ?? 0}
                  initialFurthestPercent={entry?.furthestPercent ?? 0}
                  trackingEnabled={enrolled}
                />
              )}

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="flex gap-2">
                  <NavLink slug={slug} lesson={previous} direction="previous" />
                  <NavLink slug={slug} lesson={next} direction="next" />
                </div>

                {enrolled && !entry?.locked && (
                  <Button
                    variant={completed ? "outline" : "default"}
                    disabled={progress.isCompleting}
                    onClick={() => progress.setCompleted(!completed)}
                  >
                    <CircleCheck className="size-4" aria-hidden />
                    {completed ? "Als offen markieren" : "Als erledigt markieren"}
                  </Button>
                )}
              </footer>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

/** Why the lesson itself could not be opened, in the learner's own terms. */
function LessonUnavailable({
  error,
  slug,
  onRetry,
}: {
  error: Error;
  slug: string;
  onRetry: () => void;
}) {
  const code = (error as { code?: string }).code;

  if (code === "FORBIDDEN") {
    return (
      <Alert>
        <Lock aria-hidden />
        <AlertTitle>Diese Lektion ist nicht geöffnet</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            Um diese Lektion zu sehen, musst du im Kurs eingeschrieben sein — oder deine Teilnahme
            wurde beendet.
          </p>
          <Link
            to="/learn/courses/$slug"
            params={{ slug }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Zur Kursübersicht
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (code === "NOT_FOUND") {
    return (
      <Alert>
        <Lock aria-hidden />
        <AlertTitle>Lektion nicht verfügbar</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>Diese Lektion wurde gelöscht oder ist noch nicht veröffentlicht.</p>
          <Link
            to="/learn/courses/$slug"
            params={{ slug }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Zur Kursübersicht
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return <QueryError error={error} onRetry={onRetry} />;
}

/** Previous/next, rendered as text when the neighbour is locked or absent. */
function NavLink({
  slug,
  lesson,
  direction,
}: {
  slug: string;
  lesson: { id: string; title: string; locked: boolean } | undefined;
  direction: "previous" | "next";
}) {
  const label = direction === "previous" ? "Vorherige Lektion" : "Nächste Lektion";
  const icon =
    direction === "previous" ? (
      <ChevronLeft className="size-4" aria-hidden />
    ) : (
      <ChevronRight className="size-4" aria-hidden />
    );

  if (!lesson || lesson.locked) {
    return (
      <span
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "text-muted-foreground cursor-not-allowed opacity-50",
        )}
        aria-disabled
      >
        {direction === "previous" && icon}
        {label}
        {direction === "next" && icon}
      </span>
    );
  }

  return (
    <Link
      to="/learn/courses/$slug/lessons/$lessonId"
      params={{ slug, lessonId: lesson.id }}
      className={buttonVariants({ variant: "outline", size: "sm" })}
      aria-label={`${label}: ${lesson.title}`}
    >
      {direction === "previous" && icon}
      {label}
      {direction === "next" && icon}
    </Link>
  );
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
