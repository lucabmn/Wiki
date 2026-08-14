import DashboardLayout from "@/components/layouts/dashboard-layout";
import { CourseOutlineList } from "@/components/learn/course-outline-list";
import { EnrollButton } from "@/components/learn/enroll-button";
import { PageContent } from "@/components/editor/page-content";
import { QueryError } from "@/components/query-error";
import {
  COURSE_LEVEL_LABEL,
  COURSE_ROLE_LABEL,
  COURSE_STATUS_LABEL,
  formatDuration,
  formatPrice,
} from "@/lib/learn-labels";
import { initials } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, Megaphone, PenLine, Settings2, Star, Users } from "lucide-react";

export const Route = createFileRoute("/_auth/learn/courses/$slug/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const course = useQuery(orpc.learn.courses.getBySlug.queryOptions({ input: { slug } }));
  const courseId = course.data?.id;

  const outline = useQuery({
    ...orpc.learn.lessons.outline.queryOptions({ input: { courseId: courseId ?? "" } }),
    enabled: Boolean(courseId),
  });
  const announcements = useQuery({
    ...orpc.learn.courseUpdates.list.queryOptions({ input: { courseId: courseId ?? "" } }),
    enabled: Boolean(courseId),
  });
  const reviews = useQuery({
    ...orpc.learn.courseUpdates.listReviews.queryOptions({ input: { courseId: courseId ?? "" } }),
    enabled: Boolean(courseId),
  });

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
          <Skeleton className="aspect-[3/1] w-full rounded-xl" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </DashboardLayout>
    );
  }

  const data = course.data;
  const enrolled = data.enrollment?.status === "active" || data.enrollment?.status === "completed";
  const resumeLessonId = data.enrollment?.lastLessonId ?? outline.data?.nextLessonId ?? null;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-8 p-4 md:p-6">
        <header className="space-y-4">
          {data.thumbnailUrl && (
            <div className="bg-muted aspect-[3/1] overflow-hidden rounded-xl">
              <img src={data.thumbnailUrl} alt="" className="size-full object-cover" />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {data.status !== "published" && (
              <Badge variant="outline">{COURSE_STATUS_LABEL[data.status]}</Badge>
            )}
            {data.level && <Badge variant="secondary">{COURSE_LEVEL_LABEL[data.level]}</Badge>}
            {data.topics.map((topic) => (
              <Badge
                key={topic.id}
                variant="outline"
                style={topic.color ? { borderColor: topic.color, color: topic.color } : undefined}
              >
                {topic.name}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-balance">{data.title}</h1>
              {data.tagline && <p className="text-muted-foreground text-lg">{data.tagline}</p>}
            </div>

            {/* Authoring affordances mirror the server's own decision — the API
                ships `access` with every course precisely so the UI never has to
                guess at it. */}
            {(data.access.canAuthor || data.access.canGrade) && (
              <div className="flex gap-2">
                {data.access.canAuthor && (
                  <Link
                    to="/learn/courses/$slug/edit"
                    params={{ slug }}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <PenLine className="size-4" aria-hidden />
                    Bearbeiten
                  </Link>
                )}
                {data.access.canGrade && (
                  <Link
                    to="/learn/courses/$slug/manage"
                    params={{ slug }}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <Settings2 className="size-4" aria-hidden />
                    Verwalten
                  </Link>
                )}
              </div>
            )}
          </div>

          <dl className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Fact icon={BookOpen} label="Lektionen" value={String(data.lessonCount)} />
            <Fact icon={Users} label="Teilnehmende" value={String(data.enrollmentCount)} />
            {data.estimatedMinutes ? (
              <Fact label="Dauer" value={formatDuration(data.estimatedMinutes * 60)} />
            ) : null}
            {data.averageRating !== null && (
              <Fact
                icon={Star}
                label="Bewertung"
                value={`${data.averageRating.toLocaleString("de-DE", { minimumFractionDigits: 1 })} (${data.reviewCount})`}
              />
            )}
          </dl>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-8">
            {data.description ? (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Über diesen Kurs</h2>
                <PageContent content={data.description} fallbackText="" />
              </section>
            ) : null}

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Inhalt</h2>
              {outline.isPending ? (
                <Skeleton className="h-40 w-full" />
              ) : outline.data && outline.data.chapters.length > 0 ? (
                <CourseOutlineList slug={slug} chapters={outline.data.chapters} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Für diesen Kurs sind noch keine Inhalte veröffentlicht.
                </p>
              )}
            </section>

            {(announcements.data?.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Megaphone className="size-4" aria-hidden />
                  Ankündigungen
                </h2>
                <ul className="space-y-3">
                  {announcements.data?.map((item) => (
                    <li key={item.id}>
                      <Card className="space-y-2 p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-medium">{item.title}</h3>
                          {item.publishedAt && (
                            <time className="text-muted-foreground text-xs">
                              {new Date(item.publishedAt).toLocaleDateString("de-DE")}
                            </time>
                          )}
                        </div>
                        {item.content ? (
                          <PageContent content={item.content} fallbackText="" />
                        ) : null}
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(reviews.data?.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Bewertungen</h2>
                <ul className="space-y-3">
                  {reviews.data?.map((review) => (
                    <li key={review.id}>
                      <Card className="space-y-2 p-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            <AvatarImage src={review.user?.image ?? undefined} alt="" />
                            <AvatarFallback>{initials(review.user?.name ?? "?")}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{review.user?.name}</span>
                          <span className="text-muted-foreground ml-auto text-sm">
                            {"★".repeat(review.rating)}
                            <span className="sr-only">{review.rating} von 5</span>
                          </span>
                        </div>
                        {review.comment && <p className="text-sm">{review.comment}</p>}
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card className="space-y-4 p-4">
              {data.price && !enrolled && (
                <p className="text-2xl font-semibold">
                  {formatPrice(data.price.amountCents, data.price.currency)}
                </p>
              )}

              {enrolled ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Progress value={data.enrollment!.progressPercent} />
                    <p className="text-muted-foreground text-xs">
                      {data.enrollment!.progressPercent} % abgeschlossen
                    </p>
                  </div>
                  {resumeLessonId ? (
                    <Link
                      to="/learn/courses/$slug/lessons/$lessonId"
                      params={{ slug, lessonId: resumeLessonId }}
                      className={buttonVariants({ className: "w-full" })}
                    >
                      {data.enrollment!.progressPercent > 0 ? "Fortsetzen" : "Kurs starten"}
                    </Link>
                  ) : null}
                </div>
              ) : (
                <EnrollButton course={data} />
              )}

              {data.seatsLeft !== null && !enrolled && (
                <p className="text-muted-foreground text-xs">
                  Noch {data.seatsLeft} {data.seatsLeft === 1 ? "Platz" : "Plätze"} frei
                </p>
              )}
              {data.certificateEnabled && (
                <p className="text-muted-foreground text-xs">
                  Nach Abschluss erhältst du ein Zertifikat.
                </p>
              )}
            </Card>

            {data.authors.length > 0 && (
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold">Kursteam</h2>
                <Separator />
                <ul className="space-y-3">
                  {data.authors.map((author) => (
                    <li key={author.id} className="flex items-center gap-2">
                      <Avatar className="size-8">
                        <AvatarImage src={author.image ?? undefined} alt="" />
                        <AvatarFallback>{initials(author.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{author.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {COURSE_ROLE_LABEL[author.role]}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof BookOpen;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className="size-4" aria-hidden />}
      <dt className="sr-only">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
