import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users } from "lucide-react";

import { QueryError } from "@/components/query-error";
import { timeAgo } from "@/lib/format";
import { ENROLLMENT_STATUS_LABEL } from "@/lib/learn-labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nilovon-wiki/ui/components/table";

/**
 * What the course looks like from above: the counters, where learners fall out
 * of the lesson funnel, and — only for a grader — who exactly is where.
 *
 * The split is the server's, not a nicety: `courseOverview` and `lessonFunnel`
 * are aggregates and read at `view`, while `learnerProgress` names individuals
 * and says when each of them last worked, so it takes `grade`. Asking for it
 * without that grant is a 403, which is why `canGrade` gates the query rather
 * than only the table.
 */

const PAGE_SIZE = 50;

export function CourseAnalytics({ courseId, canGrade }: { courseId: string; canGrade: boolean }) {
  const [offset, setOffset] = useState(0);

  const overview = useQuery(
    orpc.learn.analytics.courseOverview.queryOptions({ input: { courseId } }),
  );
  const funnel = useQuery(orpc.learn.analytics.lessonFunnel.queryOptions({ input: { courseId } }));
  const learners = useQuery({
    ...orpc.learn.analytics.learnerProgress.queryOptions({
      input: { courseId, limit: PAGE_SIZE, offset },
    }),
    enabled: canGrade,
  });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Überblick</h2>
        {overview.isError ? (
          <QueryError error={overview.error} onRetry={() => void overview.refetch()} />
        ) : overview.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Counter label="Einschreibungen" value={overview.data.enrollmentCount} />
            <Counter label="Aktiv" value={overview.data.activeCount} />
            <Counter label="Abgeschlossen" value={overview.data.completedCount} />
            <Counter label="Verlassen" value={overview.data.droppedCount} />
            <Counter
              label="Ø Fortschritt"
              value={`${overview.data.averageProgressPercent} %`}
              hint="Mittel über alle Einschreibungen"
            />
            <Counter
              label="Abschlussquote"
              value={`${overview.data.completionRate} %`}
              hint="Anteil abgeschlossener Einschreibungen"
            />
            <Counter
              label="Bewertung"
              value={
                overview.data.averageRating === null
                  ? "—"
                  : overview.data.averageRating.toLocaleString("de-DE", {
                      minimumFractionDigits: 1,
                    })
              }
              hint={
                overview.data.reviewCount === 1
                  ? "1 Rezension"
                  : `${overview.data.reviewCount} Rezensionen`
              }
            />
            <Counter
              label="Offene Bewertungen"
              value={overview.data.awaitingGrading}
              hint="Abgaben, die auf eine Note warten"
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Lektions-Trichter</h2>
          <p className="text-sm text-muted-foreground">
            Wie viele der {funnel.data?.enrollmentCount ?? 0} aktiven und abgeschlossenen
            Einschreibungen eine Lektion begonnen und beendet haben — in Kursreihenfolge, damit
            sichtbar wird, wo Lernende aussteigen.
          </p>
        </div>

        {funnel.isError ? (
          <QueryError error={funnel.error} onRetry={() => void funnel.refetch()} />
        ) : funnel.isPending ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : funnel.data.lessons.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>Noch keine Lektionen</EmptyTitle>
              <EmptyDescription>
                Sobald der Kurs Lektionen enthält, zeigt der Trichter den Verlauf.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <LessonFunnel
            enrollmentCount={funnel.data.enrollmentCount}
            lessons={funnel.data.lessons}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Lernende im Detail</h2>
        {!canGrade ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Die Zahlen oben sind anonym. Wer wie weit ist und wann zuletzt gearbeitet hat, ist eine
            Aussage über einzelne Personen — dafür braucht es die Berechtigung, Abgaben zu bewerten.
          </p>
        ) : learners.isError ? (
          <QueryError error={learners.error} onRetry={() => void learners.refetch()} />
        ) : learners.isPending ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : learners.data.learners.length === 0 ? (
          <Empty className="rounded-xl border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Keine Einschreibungen</EmptyTitle>
              <EmptyDescription>In diesem Kurs lernt noch niemand.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Card className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">Person</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Fortschritt</TableHead>
                    <TableHead scope="col">Lektionen</TableHead>
                    <TableHead scope="col">Zuletzt aktiv</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learners.data.learners.map((learner) => (
                    <TableRow key={learner.enrollmentId}>
                      <TableCell className="font-medium">
                        {/* The enrolment outlives the account, so an empty name
                            is a deleted user rather than missing data. */}
                        {learner.name || "Gelöschtes Konto"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{ENROLLMENT_STATUS_LABEL[learner.status]}</Badge>
                      </TableCell>
                      <TableCell className="min-w-32">
                        <Progress value={learner.progressPercent} />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {learner.progressPercent} %
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {learner.lessonsCompleted} / {learners.data.totalLessons}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {learner.lastActivityAt ? timeAgo(learner.lastActivityAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            {/* `learnerProgress` answers with a page and no total, so a full page
                is the only sign that another one follows. */}
            {offset > 0 || learners.data.learners.length === PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground tabular-nums">
                  {offset + 1}–{offset + learners.data.learners.length}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    Zurück
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={learners.data.learners.length < PAGE_SIZE}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Weiter
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function Counter({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="gap-1 p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

type FunnelLesson = {
  lessonId: string;
  title: string;
  chapterTitle: string;
  isRequired: boolean;
  published: boolean;
  startedCount: number;
  completedCount: number;
};

/**
 * The funnel as paired bars plus the numbers they stand for.
 *
 * Drawn with plain elements rather than the shared chart wrapper: `recharts`
 * lives in `@nilovon-wiki/ui`'s own dependencies and does not resolve from this
 * app, and adding a dependency to draw two bars per row is a poor trade. The
 * bars are `aria-hidden` decoration — the table cells beside them carry the same
 * values, so a screen reader reads the data once and not twice.
 */
function LessonFunnel({
  enrollmentCount,
  lessons,
}: {
  enrollmentCount: number;
  lessons: FunnelLesson[];
}) {
  // The denominator is the cohort that could have reached these lessons; a bar
  // scaled to the busiest lesson instead would hide the drop-off entirely.
  const scale = Math.max(enrollmentCount, ...lessons.map((lesson) => lesson.startedCount), 1);
  const share = (value: number) => `${Math.round((value / scale) * 100)}%`;

  return (
    <Card className="overflow-x-auto p-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">Lektion</TableHead>
            <TableHead scope="col" className="w-1/3">
              Verlauf
            </TableHead>
            <TableHead scope="col">Begonnen</TableHead>
            <TableHead scope="col">Abgeschlossen</TableHead>
            <TableHead scope="col">Abschlussquote</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lessons.map((lesson) => (
            <TableRow key={lesson.lessonId}>
              <TableCell>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{lesson.title}</span>
                    {!lesson.published ? <Badge variant="outline">Entwurf</Badge> : null}
                    {lesson.isRequired ? <Badge variant="secondary">Pflicht</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{lesson.chapterTitle}</p>
                </div>
              </TableCell>
              <TableCell>
                <div className="min-w-32 space-y-1" aria-hidden>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary/40"
                      style={{ width: share(lesson.startedCount) }}
                    />
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: share(lesson.completedCount) }}
                    />
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm tabular-nums">{lesson.startedCount}</TableCell>
              <TableCell className="text-sm tabular-nums">{lesson.completedCount}</TableCell>
              <TableCell className="text-sm tabular-nums">
                {lesson.startedCount === 0
                  ? "—"
                  : `${Math.round((lesson.completedCount / lesson.startedCount) * 100)} %`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
