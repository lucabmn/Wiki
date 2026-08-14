import { toastError } from "@/lib/query";
import { client, orpc } from "@/utils/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * How much wall-clock time may pass before playback progress is written back.
 *
 * A `<video>` fires `timeupdate` about four times a second, and every report is
 * a transaction that recomputes the whole enrolment's progress and may issue a
 * certificate — reporting per event would mean hundreds of writes per lesson.
 * The interval is the compromise: losing at most this much of a resume point is
 * invisible to the learner, and a flush on unmount covers the normal way a
 * lesson ends (navigating to the next one).
 */
const REPORT_INTERVAL_MS = 12_000;

/**
 * The longest gap between two samples that still counts as time spent. Anything
 * larger is a pause or a background tab, and `secondsSpent` is meant to be time
 * *at* the material.
 */
const ACTIVE_GAP_MS = 5_000;

export type LessonProgressHandle = {
  /** Record a sample. Cheap — nothing is sent until the next flush. */
  report: (sample: { positionSeconds?: number; furthestPercent?: number }) => void;
  /** Write pending progress now (pause, ended, leaving the lesson). */
  flush: () => void;
  /** Mark the lesson finished, or take that mark back. */
  setCompleted: (completed: boolean) => void;
  isCompleting: boolean;
};

/**
 * Reports what the learner has seen of one lesson.
 *
 * Two rules are the server's and are deliberately not re-implemented here:
 * `furthestPercent` never regresses (the handler takes a `Math.max`), and a
 * lesson with `autoCompleteAtPercent` completes itself once the reports reach
 * it. The client keeps its own monotonic high-water mark anyway, so a learner
 * scrubbing back to minute one does not spend a round-trip arguing with the
 * server about it.
 */
export function useLessonProgress({
  lessonId,
  enabled,
  initialFurthestPercent = 0,
}: {
  lessonId: string;
  /**
   * False for anyone the API would refuse: `track` requires an active
   * enrolment, so an instructor previewing their own course must not report.
   */
  enabled: boolean;
  /** Where the server already has the learner, so we never report backwards. */
  initialFurthestPercent?: number;
}): LessonProgressHandle {
  const queryClient = useQueryClient();

  const position = useRef(0);
  const furthest = useRef(initialFurthestPercent);
  const watchedMs = useRef(0);
  const lastSampleAt = useRef(0);
  const dirty = useRef(false);
  const completed = useRef(false);

  // Switching lessons reuses this hook, and carrying the previous lesson's
  // high-water mark over would report someone into a lesson they never opened.
  useEffect(() => {
    position.current = 0;
    furthest.current = 0;
    watchedMs.current = 0;
    lastSampleAt.current = 0;
    dirty.current = false;
    completed.current = false;
  }, [lessonId]);

  // The stored mark raises the floor rather than replacing it: it arrives with
  // the outline, which refetches while the lesson is open, and a reset there
  // would drop a sample the learner has already earned.
  useEffect(() => {
    furthest.current = Math.max(furthest.current, initialFurthestPercent);
  }, [initialFurthestPercent]);

  const invalidateProgress = useCallback(() => {
    // The outline draws the tick marks and the course card the percentage, so
    // both have to hear about a completion for the sidebar to tick over.
    void queryClient.invalidateQueries({ queryKey: orpc.learn.lessons.outline.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.learn.courses.key() });
  }, [queryClient]);

  const send = useCallback(async () => {
    if (!enabled || !dirty.current) return;
    // `secondsSpent` is added to the stored total server-side, so this is the
    // delta since the last report and not a running sum.
    const secondsSpent = Math.min(3600, Math.round(watchedMs.current / 1000));
    const payload = {
      lessonId,
      positionSeconds: Math.min(86_400, Math.max(0, Math.round(position.current))),
      furthestPercent: furthest.current,
      secondsSpent,
    };
    dirty.current = false;
    watchedMs.current = 0;

    try {
      const result = await client.learn.enrollments.track(payload);
      // Only the transition matters: invalidating on every tick would refetch
      // the outline four times a minute for the whole lesson.
      if (result.progress.status === "completed" && !completed.current) {
        completed.current = true;
        invalidateProgress();
      }
    } catch {
      // Swallowed on purpose. Progress is ambient, and a learner who lost their
      // connection mid-video should not be told about it every twelve seconds;
      // the next report carries the same high-water mark anyway.
    }
  }, [enabled, lessonId, invalidateProgress]);

  const report = useCallback(
    (sample: { positionSeconds?: number; furthestPercent?: number }) => {
      if (!enabled) return;
      const now = Date.now();
      if (lastSampleAt.current !== 0 && now - lastSampleAt.current <= ACTIVE_GAP_MS) {
        watchedMs.current += now - lastSampleAt.current;
      }
      lastSampleAt.current = now;

      if (sample.positionSeconds !== undefined && Number.isFinite(sample.positionSeconds)) {
        // Not clamped to the high-water mark: this is the resume point, and it
        // is supposed to follow a seek backwards.
        position.current = sample.positionSeconds;
      }
      if (sample.furthestPercent !== undefined && Number.isFinite(sample.furthestPercent)) {
        furthest.current = Math.max(
          furthest.current,
          Math.min(100, Math.max(0, Math.round(sample.furthestPercent))),
        );
      }
      dirty.current = true;
    },
    [enabled],
  );

  const flush = useCallback(() => {
    void send();
  }, [send]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => void send(), REPORT_INTERVAL_MS);
    // The cleanup reads the refs rather than any captured sample, so leaving
    // the lesson always writes the newest position instead of a stale one.
    return () => {
      window.clearInterval(timer);
      void send();
    };
  }, [enabled, send]);

  const complete = useMutation(
    orpc.learn.enrollments.complete.mutationOptions({
      onSuccess: (result) => {
        completed.current = result.progress.status === "completed";
        invalidateProgress();
        if (result.courseCompleted) {
          toast.success(
            result.certificateId
              ? "Kurs abgeschlossen — dein Zertifikat wartet auf dich."
              : "Kurs abgeschlossen.",
          );
        }
      },
      onError: toastError,
    }),
  );

  const setCompleted = useCallback(
    (value: boolean) => {
      // Flush first: the completion recomputes the course percentage, and a
      // pending position report landing afterwards would only undo the order.
      void send();
      complete.mutate({ lessonId, completed: value });
    },
    [complete, lessonId, send],
  );

  return { report, flush, setCompleted, isCompleting: complete.isPending };
}
