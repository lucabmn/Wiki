import { useMemo, useState } from "react";
import { env } from "@nilovon-wiki/env/web";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, EyeOff, FileText, ListChecks } from "lucide-react";
import { toast } from "sonner";

import { PageContent } from "@/components/editor/page-content";
import { QueryError } from "@/components/query-error";
import { formatDateTime, initials } from "@/lib/format";
import { SUBMISSION_STATUS_LABEL } from "@/lib/learn-labels";
import { toastError } from "@/lib/query";
import { client, orpc } from "@/utils/orpc";
import { Avatar, AvatarFallback, AvatarImage } from "@nilovon-wiki/ui/components/avatar";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button, buttonVariants } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nilovon-wiki/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@nilovon-wiki/ui/components/empty";
import { Input } from "@nilovon-wiki/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@nilovon-wiki/ui/components/native-select";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";

/**
 * The instructor's daily work: everything handed in across the whole course,
 * newest first, with the form that grades it or sends it back.
 *
 * Shapes derived from the client rather than imported from the API package —
 * these are exactly the wire types, and they follow the procedures if the
 * contracts ever move.
 */
type Assignment = Awaited<ReturnType<typeof client.learn.assignments.getForLesson>>;
type SubmissionRow = Awaited<ReturnType<typeof client.learn.submissions.listForAssignment>>[number];
type SubmissionDetail = Awaited<ReturnType<typeof client.learn.submissions.grade>>;

type QueueEntry = { submission: SubmissionRow; assignment: Assignment };

const STATUS_FILTERS = ["submitted", "returned", "graded", "all"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  submitted: "Offen",
  returned: "Zurückgegeben",
  graded: "Bewertet",
  all: "Alle",
};

const assetUrl = (assetId: string) => `${env.VITE_SERVER_URL}/course-assets/${assetId}/download`;

export function GradingQueue({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("submitted");
  const [open, setOpen] = useState<QueueEntry | null>(null);

  const outline = useQuery(orpc.learn.lessons.outline.queryOptions({ input: { courseId } }));

  // The API has no course-wide grading queue: `listForAssignment` is per
  // assignment, and the only way to enumerate a course's assignments is through
  // its outline. The fan-out below is an N+1 on paper; the RPC link batches
  // concurrent calls into one HTTP request, so it costs a round-trip, not N.
  const assignmentLessons = useMemo(
    () =>
      (outline.data?.chapters ?? []).flatMap((chapter) =>
        chapter.lessons.filter((lesson) => lesson.kind === "assignment"),
      ),
    [outline.data],
  );

  const assignmentQueries = useQueries({
    queries: assignmentLessons.map((lesson) => ({
      queryKey: orpc.learn.assignments.getForLesson.key({ input: { lessonId: lesson.id } }),
      // An assignment-kind lesson whose brief has not been written yet answers
      // NOT_FOUND. That is an expected state here, not a failure, and letting it
      // through would fire the global query-error toast once per empty lesson.
      queryFn: async (): Promise<Assignment | null> => {
        try {
          return await client.learn.assignments.getForLesson({ lessonId: lesson.id });
        } catch (error) {
          if ((error as { code?: string }).code === "NOT_FOUND") return null;
          throw error;
        }
      },
    })),
  });

  const assignments = assignmentQueries.flatMap((query) => (query.data ? [query.data] : []));

  const submissionQueries = useQueries({
    queries: assignments.map((assignment) => {
      // One input object for both the key and the call: an explicit
      // `status: undefined` and an absent `status` are the same request but not
      // the same cache key, and "Alle" would then never hit the cached page.
      const input = {
        assignmentId: assignment.id,
        ...(status === "all" ? {} : { status }),
      };
      return {
        queryKey: orpc.learn.submissions.listForAssignment.key({ input }),
        queryFn: () => client.learn.submissions.listForAssignment(input),
      };
    }),
  });

  // Each assignment's list arrives sorted on its own; newest-first across the
  // whole course only exists once they are merged.
  const entries: QueueEntry[] = submissionQueries
    .flatMap((query, index) => {
      const assignment = assignments[index];
      if (!assignment || !query.data) return [];
      return query.data.map((submission) => ({ submission, assignment }));
    })
    .sort(
      (a, b) =>
        (b.submission.submittedAt?.getTime() ?? 0) - (a.submission.submittedAt?.getTime() ?? 0),
    );

  const loading =
    outline.isPending ||
    assignmentQueries.some((query) => query.isPending) ||
    submissionQueries.some((query) => query.isPending);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.learn.submissions.listForAssignment.key(),
    });
  };

  if (outline.isError) {
    return <QueryError error={outline.error} onRetry={() => void outline.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="grading-status">
            Status
          </label>
          <NativeSelect
            id="grading-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            {STATUS_FILTERS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STATUS_FILTER_LABEL[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {!loading ? (
          <p className="text-sm text-muted-foreground tabular-nums">
            {entries.length === 1 ? "1 Abgabe" : `${entries.length} Abgaben`}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecks />
            </EmptyMedia>
            <EmptyTitle>Keine Aufgaben</EmptyTitle>
            <EmptyDescription>
              Dieser Kurs enthält noch keine Lektion vom Typ „Aufgabe" — es kann also nichts
              abgegeben werden.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : entries.length === 0 ? (
        <Empty className="rounded-xl border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardCheck />
            </EmptyMedia>
            <EmptyTitle>Nichts zu tun</EmptyTitle>
            <EmptyDescription>
              {status === "submitted"
                ? "Alle Abgaben sind bewertet."
                : `Keine Abgabe mit dem Status „${STATUS_FILTER_LABEL[status]}".`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.submission.id}>
              <QueueRow entry={entry} onOpen={() => setOpen(entry)} />
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {open ? (
            // Keyed on the submission so switching rows starts from empty score
            // fields instead of inheriting the previous hand-in's numbers.
            <GradingForm
              key={open.submission.id}
              entry={open}
              onDecided={refresh}
              onClose={() => setOpen(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Who handed in what, or — under blind grading — that nobody may know yet. */
function Submitter({ submission }: { submission: SubmissionRow }) {
  if (submission.user === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <EyeOff className="size-4" aria-hidden />
        Anonyme Bewertung
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar className="size-6 shrink-0">
        <AvatarImage src={submission.user.image ?? undefined} alt="" />
        <AvatarFallback className="text-[10px]">{initials(submission.user.name)}</AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium">{submission.user.name}</span>
    </span>
  );
}

function QueueRow({ entry, onOpen }: { entry: QueueEntry; onOpen: () => void }) {
  const { submission, assignment } = entry;
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{assignment.title}</span>
          <Badge variant="outline">{SUBMISSION_STATUS_LABEL[submission.status]}</Badge>
          {submission.isLate ? <Badge variant="destructive">Verspätet</Badge> : null}
          {submission.attemptNumber > 1 ? (
            <Badge variant="secondary">{submission.attemptNumber}. Versuch</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Submitter submission={submission} />
          <span>
            Abgegeben: {submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}
          </span>
          {assignment.dueAt ? <span>Fällig: {formatDateTime(assignment.dueAt)}</span> : null}
          {submission.score !== null ? (
            <span className="tabular-nums">
              {submission.score} / {submission.maxScore ?? assignment.maxGrade} Punkte
            </span>
          ) : null}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onOpen}>
        Öffnen
      </Button>
    </Card>
  );
}

/**
 * Scores one hand-in task by task, then grades it or hands it back.
 *
 * The answers are not on screen before the decision, and that is an API fact
 * rather than an omission: `listForAssignment` carries only submission-level
 * fields, and the shape that holds the learner's answers — `SubmissionDetail` —
 * is the *output* of `start`/`submit`/`grade`/`returnToLearner`, never of a read
 * a grader may perform. So the form is built from the brief's tasks, and the
 * answers appear underneath once a decision has been written and the server has
 * answered with the detail. The alternative — calling `grade` with an empty body
 * just to read it back — would mark the hand-in graded, so it is not one.
 *
 * That is also why the dialog stays open after a decision: closing it would
 * throw away the only view of the answers the grader ever gets.
 */
function GradingForm({
  entry,
  onDecided,
  onClose,
}: {
  entry: QueueEntry;
  onDecided: () => void;
  onClose: () => void;
}) {
  const { submission, assignment } = entry;
  const [scores, setScores] = useState<Record<string, string>>({});
  const [taskFeedback, setTaskFeedback] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState(submission.feedbackText);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);

  const grade = useMutation(
    orpc.learn.submissions.grade.mutationOptions({
      onSuccess: (result) => {
        setDetail(result);
        // The server owns the stored feedback from here on; leaving the box on
        // the pre-decision text would re-send stale copy on a regrade.
        setFeedback(result.feedbackText);
        toast.success("Bewertung gespeichert");
        onDecided();
      },
      onError: toastError,
    }),
  );

  const returnToLearner = useMutation(
    orpc.learn.submissions.returnToLearner.mutationOptions({
      onSuccess: (result) => {
        setDetail(result);
        // The server owns the stored feedback from here on; leaving the box on
        // the pre-decision text would re-send stale copy on a regrade.
        setFeedback(result.feedbackText);
        toast.success("Zur Überarbeitung zurückgegeben");
        onDecided();
      },
      onError: toastError,
    }),
  );

  const pending = grade.isPending || returnToLearner.isPending;

  // Only the tasks the grader actually scored travel: the server keeps the score
  // a task already carried for anything left out, so an empty field means
  // "unchanged" rather than "zero".
  const scoredTasks = assignment.tasks.flatMap((task) => {
    const raw = scores[task.id];
    if (raw === undefined || raw.trim() === "") return [];
    const score = Number(raw);
    if (!Number.isInteger(score) || score < 0 || score > task.maxGrade) return [];
    const note = taskFeedback[task.id]?.trim();
    return [{ taskId: task.id, score, feedback: note ? note : null }];
  });

  const invalidScore = assignment.tasks.some((task) => {
    const raw = scores[task.id];
    if (raw === undefined || raw.trim() === "") return false;
    const score = Number(raw);
    return !Number.isInteger(score) || score < 0 || score > task.maxGrade;
  });

  const answerByTask = new Map((detail?.tasks ?? []).map((task) => [task.taskId, task]));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{assignment.title}</DialogTitle>
        <DialogDescription>
          {submission.attemptNumber}. Versuch ·{" "}
          {submission.submittedAt ? formatDateTime(submission.submittedAt) : "—"}
          {assignment.dueAt ? ` · fällig ${formatDateTime(assignment.dueAt)}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Submitter submission={submission} />
          <Badge variant="outline">{SUBMISSION_STATUS_LABEL[submission.status]}</Badge>
          {submission.isLate ? <Badge variant="destructive">Verspätet</Badge> : null}
        </div>

        {submission.user === null ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Diese Aufgabe wird anonym bewertet. Wer sie abgegeben hat, wird erst nach der Bewertung
            sichtbar.
          </p>
        ) : null}

        {assignment.instructions ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Aufgabenstellung</h3>
            <PageContent content={assignment.instructions} fallbackText="" />
          </section>
        ) : null}

        <Separator />

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Teilaufgaben</h3>

          {detail === null ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              Die eingereichten Antworten stehen in dieser Ansicht noch nicht zur Verfügung: die API
              liefert sie erst als Antwort auf die Bewertung. Sie erscheinen unten, sobald die
              Bewertung gespeichert oder die Abgabe zurückgegeben wurde.
            </p>
          ) : null}

          {assignment.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Diese Aufgabe hat keine Teilaufgaben — sie kann nicht mit Punkten bewertet werden.
            </p>
          ) : (
            <ul className="space-y-4">
              {assignment.tasks.map((task) => {
                const answer = answerByTask.get(task.id);
                return (
                  <li key={task.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{task.title}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        max. {task.maxGrade} Punkte
                      </span>
                    </div>

                    {answer ? (
                      <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
                        {answer.contentText ? (
                          <p className="text-sm whitespace-pre-wrap">{answer.contentText}</p>
                        ) : null}
                        {answer.assetId ? (
                          <a
                            href={assetUrl(answer.assetId)}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            <Download className="size-4" aria-hidden />
                            Datei herunterladen
                          </a>
                        ) : null}
                        {answer.quizAttemptId ? (
                          <p className="text-xs text-muted-foreground">
                            Quiz-Versuch abgegeben — die Punkte stammen aus der automatischen
                            Auswertung.
                          </p>
                        ) : null}
                        {!answer.contentText && !answer.assetId && !answer.quizAttemptId ? (
                          <p className="text-xs text-muted-foreground">
                            Zu dieser Teilaufgabe wurde nichts abgegeben.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1.5">
                        <label
                          className="text-xs font-medium text-muted-foreground"
                          htmlFor={`score-${task.id}`}
                        >
                          Punkte
                        </label>
                        <Input
                          id={`score-${task.id}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={task.maxGrade}
                          step={1}
                          className="w-28"
                          value={scores[task.id] ?? ""}
                          disabled={pending}
                          onChange={(event) =>
                            setScores((previous) => ({
                              ...previous,
                              [task.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="min-w-48 flex-1 space-y-1.5">
                        <label
                          className="text-xs font-medium text-muted-foreground"
                          htmlFor={`feedback-${task.id}`}
                        >
                          Anmerkung
                        </label>
                        <Input
                          id={`feedback-${task.id}`}
                          value={taskFeedback[task.id] ?? ""}
                          disabled={pending}
                          placeholder="Optional"
                          onChange={(event) =>
                            setTaskFeedback((previous) => ({
                              ...previous,
                              [task.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="submission-feedback">
            Rückmeldung an die Lernenden
          </label>
          <Textarea
            id="submission-feedback"
            rows={4}
            value={feedback}
            disabled={pending}
            placeholder="Was war gut, was fehlt noch?"
            onChange={(event) => setFeedback(event.target.value)}
          />
        </section>

        {invalidScore ? (
          <p className="text-sm text-destructive">
            Mindestens eine Punktzahl liegt über dem Maximum der Teilaufgabe oder ist keine ganze
            Zahl.
          </p>
        ) : null}

        {detail ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {detail.status === "graded"
              ? `Bewertet: ${detail.score ?? 0} von ${detail.maxScore ?? assignment.maxGrade} Punkten — ${
                  detail.passed ? "bestanden" : "nicht bestanden"
                }.`
              : "Die Abgabe liegt wieder bei den Lernenden."}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Schließen
          </Button>
          <Button
            variant="outline"
            disabled={pending || (detail ?? submission).status === "returned"}
            onClick={() =>
              returnToLearner.mutate({
                id: submission.id,
                feedbackText: feedback,
              })
            }
          >
            <FileText className="size-4" aria-hidden />
            {returnToLearner.isPending ? "Zurückgeben …" : "Zur Überarbeitung zurückgeben"}
          </Button>
          <Button
            disabled={pending || invalidScore}
            onClick={() =>
              grade.mutate({
                id: submission.id,
                tasks: scoredTasks,
                feedbackText: feedback,
              })
            }
          >
            <ClipboardCheck className="size-4" aria-hidden />
            {grade.isPending ? "Bewerten …" : detail ? "Neu bewerten" : "Bewerten"}
          </Button>
        </div>
      </div>
    </>
  );
}
