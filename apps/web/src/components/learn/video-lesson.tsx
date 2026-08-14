import { useLessonProgress } from "@/components/learn/use-lesson-progress";
import { env } from "@nilovon-wiki/env/web";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { FileWarning } from "lucide-react";
import { useRef, type SyntheticEvent } from "react";

/**
 * The video player.
 *
 * `assetUrl` is the API's range-aware proxy (`/course-assets/{id}/inline`),
 * which answers `206` for a `Range` header — that is what makes scrubbing work
 * without re-downloading the lesson, and why `preload="metadata"` is enough to
 * get a duration and a seek bar without pulling the file.
 *
 * Auto-completion is deliberately absent: `autoCompleteAtPercent` is evaluated
 * inside `enrollments.track`, so the browser only has to keep reporting. A
 * second copy of the rule here would drift from it the first time the threshold
 * is edited.
 */
export function VideoLesson({
  lesson,
  resumeAtSeconds,
  initialFurthestPercent,
  trackingEnabled,
}: {
  lesson: { id: string; title: string; assetUrl: string | null; durationSeconds: number | null };
  /** The learner's stored resume point, from the outline. */
  resumeAtSeconds: number;
  initialFurthestPercent: number;
  trackingEnabled: boolean;
}) {
  const resumed = useRef(false);
  const progress = useLessonProgress({
    lessonId: lesson.id,
    enabled: trackingEnabled,
    initialFurthestPercent,
  });

  if (!lesson.assetUrl) {
    return (
      <Alert>
        <FileWarning aria-hidden />
        <AlertTitle>Kein Video hinterlegt</AlertTitle>
        <AlertDescription>
          Für diese Lektion wurde noch keine Videodatei hochgeladen.
        </AlertDescription>
      </Alert>
    );
  }

  // The asset path is relative to the API server, which is a different origin
  // from the web app in every deployment of this stack.
  const source = `${env.VITE_SERVER_URL}${lesson.assetUrl}`;

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    if (resumed.current) return;
    resumed.current = true;
    const video = event.currentTarget;
    // Resuming within a second of the end would drop the learner onto the
    // credits of a lesson they already finished, so that case starts over.
    if (
      resumeAtSeconds > 0 &&
      Number.isFinite(video.duration) &&
      resumeAtSeconds < video.duration - 1
    ) {
      video.currentTime = resumeAtSeconds;
    }
  };

  const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    progress.report({
      positionSeconds: video.currentTime,
      furthestPercent: duration ? (video.currentTime / duration) * 100 : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <video
        src={source}
        controls
        preload="metadata"
        aria-label={`Video: ${lesson.title}`}
        className="bg-muted aspect-video w-full rounded-xl"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        // A pause or the end of the video is the moment the learner's position
        // is worth the most, so it is written immediately instead of waiting
        // out the interval.
        onPause={progress.flush}
        onEnded={progress.flush}
      >
        Dein Browser kann dieses Video nicht abspielen.
      </video>
      {resumeAtSeconds > 0 && (
        <p className="text-muted-foreground text-xs">
          Wiedergabe wird an der zuletzt gesehenen Stelle fortgesetzt.
        </p>
      )}
    </div>
  );
}
