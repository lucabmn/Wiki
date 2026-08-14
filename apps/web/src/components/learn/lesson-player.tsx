import { PageContent } from "@/components/editor/page-content";
import { AssignmentPanel } from "@/components/learn/assignment-panel";
import { QuizRunner } from "@/components/learn/quiz-runner";
import { VideoLesson } from "@/components/learn/video-lesson";
import { client } from "@/utils/orpc";
import { env } from "@nilovon-wiki/env/web";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Download, ExternalLink, FileWarning, ListChecks } from "lucide-react";

type Lesson = Awaited<ReturnType<typeof client.learn.lessons.get>>;

/**
 * Renders the body of a lesson according to its kind.
 *
 * The dispatch lives in one place because `kind` is the column that decides
 * which payload of a lesson is meaningful — the API refuses to publish a video
 * lesson without a file for the same reason — and a player that inspected the
 * payload instead would show an empty page for the one case the server already
 * ruled out.
 */
export function LessonPlayer({
  lesson,
  courseId,
  resumeAtSeconds,
  initialFurthestPercent,
  trackingEnabled,
}: {
  lesson: Lesson;
  courseId: string;
  resumeAtSeconds: number;
  initialFurthestPercent: number;
  trackingEnabled: boolean;
}) {
  switch (lesson.kind) {
    case "dynamic":
      return (
        <PageContent
          content={lesson.content}
          fallbackText=""
          emptyLabel="Diese Lektion hat noch keinen Inhalt."
        />
      );

    case "video":
      return (
        <VideoLesson
          lesson={lesson}
          resumeAtSeconds={resumeAtSeconds}
          initialFurthestPercent={initialFurthestPercent}
          trackingEnabled={trackingEnabled}
        />
      );

    case "document":
      return <DocumentLesson lesson={lesson} />;

    case "embed":
      return <EmbedLesson lesson={lesson} />;

    case "quiz":
      return <QuizLesson lesson={lesson} />;

    case "assignment":
      return <AssignmentPanel lessonId={lesson.id} courseId={courseId} />;
  }
}

/**
 * An uploaded document, shown in place.
 *
 * The download link is unconditional rather than an error state: the wire
 * carries no MIME type, and the proxy answers `415` for anything outside its
 * inline whitelist, so the browser is the only party that can tell whether the
 * frame will render — and a learner staring at a blank frame needs the link
 * without having to work that out.
 */
function DocumentLesson({ lesson }: { lesson: Lesson }) {
  if (!lesson.assetId || !lesson.assetUrl) {
    return (
      <Alert>
        <FileWarning aria-hidden />
        <AlertTitle>Kein Dokument hinterlegt</AlertTitle>
        <AlertDescription>Für diese Lektion wurde noch keine Datei hochgeladen.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <iframe
        src={`${env.VITE_SERVER_URL}${lesson.assetUrl}`}
        title={lesson.title}
        className="bg-muted h-[70vh] w-full rounded-xl border"
      />
      <a
        href={`${env.VITE_SERVER_URL}/course-assets/${lesson.assetId}/download`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <Download className="size-4" aria-hidden />
        Dokument herunterladen
      </a>
    </div>
  );
}

/**
 * A third-party page embedded in the lesson.
 *
 * The sandbox is the point: the frame runs foreign code, so it gets scripts and
 * its own origin (both of which every video host needs) and nothing that would
 * let it navigate the wiki around the learner. `no-referrer` keeps our URLs —
 * which name courses and lessons — out of the embedded host's logs.
 */
function EmbedLesson({ lesson }: { lesson: Lesson }) {
  if (!lesson.embedUrl) {
    return (
      <Alert>
        <FileWarning aria-hidden />
        <AlertTitle>Kein Inhalt eingebettet</AlertTitle>
        <AlertDescription>Für diese Lektion wurde noch keine Adresse hinterlegt.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-muted aspect-video w-full overflow-hidden rounded-xl border">
        <iframe
          src={lesson.embedUrl}
          title={lesson.title}
          className="size-full"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        />
      </div>
      <a
        href={lesson.embedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
      >
        <ExternalLink className="size-4" aria-hidden />
        In neuem Tab öffnen
      </a>
    </div>
  );
}

/**
 * A quiz taken as a lesson.
 *
 * There is no lesson → quiz link on any shape a learner may read: `LessonSchema`
 * has no `quizId`, and listing a course's quizzes needs the authoring
 * capability. The only place an id could have been stored is the lesson's own
 * free-form `content`, so that is read defensively — and when it holds nothing
 * usable the learner is told plainly instead of being shown an empty page.
 */
function QuizLesson({ lesson }: { lesson: Lesson }) {
  const quizId = quizIdFromContent(lesson.content);
  if (!quizId) {
    return (
      <Alert>
        <ListChecks aria-hidden />
        <AlertTitle>Kein Quiz verknüpft</AlertTitle>
        <AlertDescription>
          Mit dieser Lektion ist noch kein Quiz verbunden. Wende dich an das Kursteam.
        </AlertDescription>
      </Alert>
    );
  }
  return <QuizRunner quizId={quizId} lessonId={lesson.id} />;
}

function quizIdFromContent(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const candidate = (content as { quizId?: unknown }).quizId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
