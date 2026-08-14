import { COURSE_LEVEL_LABEL, COURSE_STATUS_LABEL, formatDuration } from "@/lib/learn-labels";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Progress } from "@nilovon-wiki/ui/components/progress";
import { cn } from "@nilovon-wiki/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { BookOpen, GraduationCap, Star, Users } from "lucide-react";

export type CourseCardData = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  thumbnailUrl: string | null;
  status: string;
  level: string | null;
  estimatedMinutes: number | null;
  lessonCount: number;
  enrollmentCount: number;
  averageRating: number | null;
  reviewCount: number;
  topics: { id: string; name: string; color: string | null }[];
  enrollment: { status: string; progressPercent: number } | null;
};

/**
 * One course in the catalog.
 *
 * The whole card is a single link rather than a card with a button in it: a
 * grid of cards where only part of each is clickable is the kind of thing that
 * reads fine and feels broken.
 */
export function CourseCard({ course }: { course: CourseCardData }) {
  const enrolled = course.enrollment?.status === "active";
  const completed = course.enrollment?.status === "completed";

  return (
    <Link
      to="/learn/courses/$slug"
      params={{ slug: course.slug }}
      className="group focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Card className="flex h-full flex-col gap-0 overflow-hidden p-0 transition-shadow group-hover:shadow-md">
        <CourseThumbnail course={course} />

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {course.status !== "published" && (
              <Badge variant="outline">{COURSE_STATUS_LABEL[course.status]}</Badge>
            )}
            {course.level && <Badge variant="secondary">{COURSE_LEVEL_LABEL[course.level]}</Badge>}
            {course.topics.slice(0, 2).map((topic) => (
              <Badge
                key={topic.id}
                variant="outline"
                style={topic.color ? { borderColor: topic.color, color: topic.color } : undefined}
              >
                {topic.name}
              </Badge>
            ))}
          </div>

          <div className="flex-1 space-y-1">
            <h3 className="leading-snug font-semibold text-balance">{course.title}</h3>
            {course.tagline && (
              <p className="text-muted-foreground line-clamp-2 text-sm">{course.tagline}</p>
            )}
          </div>

          <dl className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center gap-1">
              <BookOpen className="size-3.5" aria-hidden />
              <dt className="sr-only">Lektionen</dt>
              <dd>{course.lessonCount}</dd>
            </div>
            {course.estimatedMinutes ? (
              <div className="flex items-center gap-1">
                <dt className="sr-only">Dauer</dt>
                <dd>{formatDuration(course.estimatedMinutes * 60)}</dd>
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              <dt className="sr-only">Teilnehmende</dt>
              <dd>{course.enrollmentCount}</dd>
            </div>
            {course.averageRating !== null && (
              <div className="flex items-center gap-1">
                <Star className="size-3.5 fill-current" aria-hidden />
                <dt className="sr-only">Bewertung</dt>
                <dd>
                  {course.averageRating.toLocaleString("de-DE", { minimumFractionDigits: 1 })}
                  <span className="sr-only"> von 5, </span>
                  <span aria-hidden> · </span>
                  {course.reviewCount}
                </dd>
              </div>
            )}
          </dl>

          {/* Only shown once someone is actually taking the course — a 0 % bar on
              every card in the catalog would be noise, not information. */}
          {(enrolled || completed) && (
            <div className="space-y-1.5">
              <Progress value={completed ? 100 : course.enrollment!.progressPercent} />
              <p className="text-muted-foreground text-xs">
                {completed
                  ? "Abgeschlossen"
                  : `${course.enrollment!.progressPercent} % abgeschlossen`}
              </p>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

/**
 * The cover image, or a generated stand-in.
 *
 * A course without a thumbnail still needs to be distinguishable at a glance in
 * a grid, so the fallback derives a stable hue from the title rather than
 * painting every placeholder the same grey.
 */
function CourseThumbnail({ course }: { course: CourseCardData }) {
  const completed = course.enrollment?.status === "completed";

  if (course.thumbnailUrl) {
    return (
      <div className="bg-muted relative aspect-video overflow-hidden">
        <img
          src={course.thumbnailUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        {completed && <CompletedMark />}
      </div>
    );
  }

  const hue = hueFromString(course.title);
  return (
    <div
      className="relative flex aspect-video items-center justify-center"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 92%), hsl(${(hue + 40) % 360} 70% 84%))`,
      }}
    >
      <GraduationCap className="size-10" style={{ color: `hsl(${hue} 45% 35%)` }} aria-hidden />
      {completed && <CompletedMark />}
    </div>
  );
}

function CompletedMark() {
  return (
    <div className={cn("absolute top-2 right-2")}>
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Abgeschlossen</Badge>
    </div>
  );
}

/** Stable 0..359 hue for a string, so a course always gets the same colour. */
function hueFromString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return hash;
}
