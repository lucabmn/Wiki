import { ChapterListEditor } from "@/components/learn/chapter-list-editor";
import { CourseSettingsForm } from "@/components/learn/course-settings-form";
import { CourseThumbnailUpload } from "@/components/learn/course-thumbnail-upload";
import { LessonEditor, toastLearnError } from "@/components/learn/lesson-editor";
import { COURSE_STATUS_LABEL } from "@/lib/learn-labels";
import { useInvalidate } from "@/lib/query";
import { client, orpc } from "@/utils/orpc";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button, buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nilovon-wiki/ui/components/tabs";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Eye, EyeOff, ListTree, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type CourseDetail = Awaited<ReturnType<typeof client.learn.courses.getBySlug>>;

/**
 * The authoring shell: curriculum beside the selected lesson, settings on their
 * own tab, and one prominent publish control.
 *
 * The selected lesson is component state rather than a search param — the route
 * tree is generated and committed, and a new search schema would mean
 * regenerating it. Nothing else about the builder depends on being linkable.
 */
export function CourseBuilder({ course }: { course: CourseDetail }) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const invalidateCourses = useInvalidate(orpc.learn.courses.key());

  const publish = useMutation(
    orpc.learn.courses.publish.mutationOptions({
      onSuccess: () => {
        invalidateCourses();
        toast.success("Kurs veröffentlicht");
      },
      // The server refuses to publish a course with no lessons, and says so in
      // words; `toastLearnError` keeps that reason instead of the generic
      // "Die Eingabe ist ungültig" every BAD_REQUEST would otherwise become.
      onError: toastLearnError,
    }),
  );
  const unpublish = useMutation(
    orpc.learn.courses.unpublish.mutationOptions({
      onSuccess: () => {
        invalidateCourses();
        toast.success("Kurs auf Entwurf zurückgesetzt");
      },
      onError: toastLearnError,
    }),
  );

  const published = course.status === "published";
  const busy = publish.isPending || unpublish.isPending;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-3">
        <Link
          to="/learn/courses/$slug"
          params={{ slug: course.slug }}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Zurück zum Kurs
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{course.title}</h1>
            <div className="flex items-center gap-2">
              <Badge variant={published ? "default" : "outline"}>
                {COURSE_STATUS_LABEL[course.status]}
              </Badge>
              <span className="text-muted-foreground text-sm">
                {course.lessonCount} {course.lessonCount === 1 ? "Lektion" : "Lektionen"}
              </span>
            </div>
          </div>

          {/* Publishing is a `manage` decision server-side, not an authoring
              one, so an instructor sees why the control is absent rather than a
              button that answers 403. */}
          {course.access.canManage ? (
            <Button
              type="button"
              variant={published ? "outline" : "default"}
              disabled={busy}
              onClick={() =>
                published ? unpublish.mutate({ id: course.id }) : publish.mutate({ id: course.id })
              }
            >
              {published ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              {published ? "Veröffentlichung zurückziehen" : "Kurs veröffentlichen"}
            </Button>
          ) : (
            <p className="text-muted-foreground max-w-64 text-xs">
              Veröffentlichen kann nur die Kursleitung.
            </p>
          )}
        </div>
      </header>

      <Tabs defaultValue="curriculum">
        <TabsList>
          <TabsTrigger value="curriculum">
            <ListTree className="size-4" aria-hidden />
            Inhalte
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 className="size-4" aria-hidden />
            Einstellungen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="curriculum" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            <div className="lg:sticky lg:top-6 lg:self-start">
              <ChapterListEditor
                courseId={course.id}
                canAuthor={course.access.canAuthor}
                selectedLessonId={selectedLessonId}
                onSelectLesson={setSelectedLessonId}
              />
            </div>

            <Card className="p-4">
              {selectedLessonId ? (
                <LessonEditor
                  key={selectedLessonId}
                  lessonId={selectedLessonId}
                  courseId={course.id}
                  canAuthor={course.access.canAuthor}
                />
              ) : (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  Wähle links eine Lektion aus, um sie zu bearbeiten — oder lege eine neue an.
                </p>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <CourseSettingsForm course={course} />
            <div className="lg:sticky lg:top-6 lg:self-start">
              <CourseThumbnailUpload course={course} disabled={!course.access.canAuthor} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
