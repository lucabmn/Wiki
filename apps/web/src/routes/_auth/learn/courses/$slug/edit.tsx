import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";

import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CourseBuilder } from "@/components/learn/course-builder";
import { QueryError } from "@/components/query-error";
import { orpc } from "@/utils/orpc";
import { buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";

export const Route = createFileRoute("/_auth/learn/courses/$slug/edit")({
  component: RouteComponent,
});

/**
 * The authoring surface. The route's whole job is to resolve the course and
 * decide whether the caller may author it; everything else is `CourseBuilder`.
 *
 * The gate reads `access.canAuthor`, which the server ships with the course
 * from the same resolver its handlers enforce — so this cannot drift from what
 * a save would actually be allowed to do. Someone without it gets a refusal
 * that says which way back, not an editor whose every button 403s.
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
        <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-96 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (!course.data.access.canAuthor) {
    return (
      <DashboardLayout>
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
          <Link
            to="/learn/courses/$slug"
            params={{ slug }}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Zurück zum Kurs
          </Link>
          <Card className="text-muted-foreground flex items-start gap-3 p-6 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Kursinhalte bearbeiten darf nur, wer im Kursteam mindestens Dozent ist. Wende dich an
              die Kursleitung, wenn du daran mitarbeiten sollst.
            </p>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <CourseBuilder course={course.data} />
    </DashboardLayout>
  );
}
