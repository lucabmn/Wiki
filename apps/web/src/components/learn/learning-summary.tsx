import { QueryError } from "@/components/query-error";
import { timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Award, CalendarClock, GraduationCap, PlayCircle } from "lucide-react";
import { useMemo } from "react";

/**
 * The signed-in learner's own standing, compact enough to sit on a dashboard
 * next to surfaces that have nothing to do with courses.
 *
 * Two queries rather than one, because `analytics.myLearning` answers "how
 * much" and not "which": it returns counts plus the deadlines, and its
 * deadlines carry a `courseId` while every course route in this app is keyed by
 * slug. So the enrolled catalog is fetched alongside it — that is also the only
 * place `lastLessonId` lives, which is what makes "Fortsetzen" resume where the
 * learner stopped instead of dropping them back on the landing page.
 */
export function LearningSummary({ className }: { className?: string }) {
  const overview = useQuery(orpc.learn.analytics.myLearning.queryOptions({ input: {} }));
  // `includeArchived` on purpose: an enrolment outlives the archiving of its
  // course, and a resume link that silently disappears reads as data loss.
  const courses = useQuery(
    orpc.learn.courses.list.queryOptions({ input: { enrolledOnly: true, includeArchived: true } }),
  );

  const bySlug = useMemo(
    () => new Map((courses.data ?? []).map((course) => [course.id, course.slug])),
    [courses.data],
  );

  const inProgress = useMemo(
    () =>
      (courses.data ?? [])
        .filter((course) => course.enrollment?.status === "active")
        // The furthest along first: those are the ones a learner comes back to.
        .sort((a, b) => (b.enrollment?.progressPercent ?? 0) - (a.enrollment?.progressPercent ?? 0))
        .slice(0, 3),
    [courses.data],
  );

  if (overview.isError) {
    return (
      <Card className={cn("p-4", className)}>
        <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
      </Card>
    );
  }

  if (overview.isPending || !overview.data) {
    return (
      <Card className={cn("space-y-4 p-4", className)}>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-14 w-full" />
      </Card>
    );
  }

  const data = overview.data;
  const dueSoon = data.assignmentsDueSoon.slice(0, 3);
  // Read off the counts, never off the list below: the list is a second query
  // that can be short (paginated), stale or failed, and "du belegst keinen
  // Kurs" printed under a tile saying three are done is worse than no line.
  const nothingYet =
    data.coursesInProgress === 0 &&
    data.coursesCompleted === 0 &&
    data.certificatesEarned === 0 &&
    dueSoon.length === 0;

  return (
    <Card className={cn("gap-4 p-4", className)}>
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={PlayCircle} label="Laufende Kurse" value={data.coursesInProgress} />
        <Stat icon={GraduationCap} label="Abgeschlossen" value={data.coursesCompleted} />
        {/* `myLearning` counts only certificates that still stand, so the label
            has to say so — the certificate list beside this widget shows
            revoked ones too, and two rows next to a "1" would look like a bug. */}
        <Stat icon={Award} label="Gültige Zertifikate" value={data.certificatesEarned} />
      </div>

      {/* The resume links live in the other query; when it fails the section
          below simply is not there, which reads as "nothing to continue". */}
      {courses.isError && (
        <QueryError
          compact
          error={courses.error}
          onRetry={() => void courses.refetch()}
          className="px-0"
        />
      )}

      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Weiterlernen
          </h3>
          <ul className="divide-border/60 divide-y">
            {inProgress.map((course) => (
              <li key={course.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm font-medium">{course.title}</p>
                  <Progress value={course.enrollment?.progressPercent ?? 0} />
                </div>
                {/* The lesson route needs both slug and lesson; without a
                    `lastLessonId` the learner has not opened anything yet, so
                    the course page is the honest destination. */}
                {course.enrollment?.lastLessonId ? (
                  <Link
                    to="/learn/courses/$slug/lessons/$lessonId"
                    params={{ slug: course.slug, lessonId: course.enrollment.lastLessonId }}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Fortsetzen
                  </Link>
                ) : (
                  <Link
                    to="/learn/courses/$slug"
                    params={{ slug: course.slug }}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Starten
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dueSoon.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
            <CalendarClock className="size-3.5" aria-hidden />
            Bald fällig
          </h3>
          <ul className="divide-border/60 divide-y">
            {dueSoon.map((item) => {
              const slug = bySlug.get(item.courseId);
              const body = (
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="text-muted-foreground truncate text-xs">{item.courseTitle}</p>
                  </div>
                  <time
                    dateTime={item.dueAt.toISOString()}
                    className="text-muted-foreground shrink-0 text-xs"
                  >
                    {timeAgo(item.dueAt)}
                  </time>
                </div>
              );

              // Not every course behind a deadline is necessarily in the list
              // above — it is paginated and scoped — and a link without a slug
              // cannot be built, so the row stays plain text rather than
              // pointing somewhere wrong.
              return (
                <li key={item.assignmentId} className="first:[&>*]:pt-0 last:[&>*]:pb-0">
                  {slug ? (
                    <Link
                      to="/learn/courses/$slug/lessons/$lessonId"
                      params={{ slug, lessonId: item.lessonId }}
                      className="hover:bg-muted/50 -mx-2 block rounded-md px-2 transition-colors"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {nothingYet && (
        <p className="text-muted-foreground text-sm">
          Du belegst gerade keinen Kurs.{" "}
          <Link to="/learn" className="text-primary font-medium hover:underline">
            Zum Katalog
          </Link>
        </p>
      )}
    </Card>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Award; label: string; value: number }) {
  return (
    <div className="bg-muted/40 space-y-1 rounded-lg p-3">
      <Icon className="text-muted-foreground size-4" aria-hidden />
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs leading-tight">{label}</p>
    </div>
  );
}
