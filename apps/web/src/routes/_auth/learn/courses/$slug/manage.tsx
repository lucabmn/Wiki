import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CourseAnalytics } from "@/components/learn/course-analytics";
import { CourseAnnouncements } from "@/components/learn/course-announcements";
import { CourseRoster } from "@/components/learn/course-roster";
import { CourseStaff } from "@/components/learn/course-staff";
import { GradingQueue } from "@/components/learn/grading-queue";
import { QueryError } from "@/components/query-error";
import { COURSE_ROLE_LABEL, COURSE_STATUS_LABEL } from "@/lib/learn-labels";
import { orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nilovon-wiki/ui/components/tabs";

export const Route = createFileRoute("/_auth/learn/courses/$slug/manage")({
  component: RouteComponent,
});

/**
 * Everything a course is run with, behind one set of tabs: who is enrolled,
 * what is waiting to be marked, how the cohort is doing, who teaches it and
 * what has been announced.
 *
 * Each tab is gated on the capability the corresponding handlers enforce, which
 * `courses.getBySlug` ships with the course precisely so the UI never has to
 * guess. The capabilities are not nested — an assistant grades but does not
 * administer — so a missing one is refused per tab, with the role that would
 * carry it named, rather than by hiding the tab or showing an empty table that
 * looks like a broken query.
 */
function RouteComponent() {
  const { slug } = Route.useParams();
  const course = useQuery(orpc.learn.courses.getBySlug.queryOptions({ input: { slug } }));

  if (course.isError) {
    return (
      <DashboardLayout>
        <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
          <QueryError error={course.error} onRetry={() => void course.refetch()} />
        </div>
      </DashboardLayout>
    );
  }

  if (course.isPending || !course.data) {
    return (
      <DashboardLayout>
        <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-64 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  const data = course.data;
  const { canGrade, canManage, canAuthor } = data.access;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
        <header className="space-y-3">
          <Link
            to="/learn/courses/$slug"
            params={{ slug }}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Zurück zum Kurs
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
            {data.status !== "published" ? (
              <Badge variant="outline">{COURSE_STATUS_LABEL[data.status]}</Badge>
            ) : null}
            {data.access.role ? (
              <Badge variant="secondary">{COURSE_ROLE_LABEL[data.access.role]}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">Kursverwaltung</p>
        </header>

        {/* The route itself is only worth opening with at least one of the
            capabilities below; five refusals in a row would say the same thing
            five times. */}
        {!canGrade && !canManage && !canAuthor ? (
          <Refusal requirement="Dieser Bereich ist dem Kursteam vorbehalten." />
        ) : (
          <Tabs defaultValue="roster">
            <TabsList className="flex-wrap">
              <TabsTrigger value="roster">Teilnehmende</TabsTrigger>
              <TabsTrigger value="grading">Bewertung</TabsTrigger>
              <TabsTrigger value="analytics">Auswertung</TabsTrigger>
              <TabsTrigger value="staff">Kursteam</TabsTrigger>
              <TabsTrigger value="announcements">Ankündigungen</TabsTrigger>
            </TabsList>

            <TabsContent value="roster" className="pt-4">
              {canGrade ? (
                <CourseRoster
                  courseId={data.id}
                  organizationId={data.organizationId}
                  canManage={canManage}
                />
              ) : (
                <Refusal
                  requirement={
                    <>
                      Die Teilnehmendenliste nennt einzelne Personen. Sie steht ab der Rolle „
                      {COURSE_ROLE_LABEL.assistant}" offen.
                    </>
                  }
                />
              )}
            </TabsContent>

            <TabsContent value="grading" className="pt-4">
              {canGrade ? (
                <GradingQueue courseId={data.id} />
              ) : (
                <Refusal
                  requirement={
                    <>
                      Abgaben bewerten darf, wer mindestens die Rolle „{COURSE_ROLE_LABEL.assistant}
                      " hat.
                    </>
                  }
                />
              )}
            </TabsContent>

            <TabsContent value="analytics" className="pt-4">
              {/* Deliberately not gated: the aggregates read at view level, and
                  the component itself withholds the per-person table. */}
              <CourseAnalytics courseId={data.id} canGrade={canGrade} />
            </TabsContent>

            <TabsContent value="staff" className="pt-4">
              {/* Ungated for the same reason as the analytics tab: who teaches a
                  course reads at view level — changing the list is what needs
                  `manage`, and the panel refuses that on its own. */}
              <CourseStaff
                courseId={data.id}
                organizationId={data.organizationId}
                canManage={canManage}
              />
            </TabsContent>

            <TabsContent value="announcements" className="pt-4">
              {/* Listing reads at view level; writing needs `author`, which an
                  assistant does not have — the panel says so rather than
                  offering buttons the server would refuse. */}
              <CourseAnnouncements courseId={data.id} canAuthor={canAuthor} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}

/** A missing capability, named — an empty panel would read as a failed load. */
function Refusal({ requirement }: { requirement: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <Lock className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">Dafür fehlt dir die Berechtigung.</p>
      <p className="max-w-md text-sm text-muted-foreground">{requirement}</p>
    </div>
  );
}
