import { PageContent } from "@/components/editor/page-content";
import { QuizRunner } from "@/components/learn/quiz-runner";
import { QueryError } from "@/components/query-error";
import { SUBMISSION_STATUS_LABEL } from "@/lib/learn-labels";
import { toastError, useInvalidate } from "@/lib/query";
import { client, friendlyErrorMessage, orpc } from "@/utils/orpc";
import { env } from "@nilovon-wiki/env/web";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { Textarea } from "@nilovon-wiki/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type AssignmentDetail = Awaited<ReturnType<typeof client.learn.assignments.getForLesson>>;
type AssignmentTask = AssignmentDetail["tasks"][number];
type SubmissionDetail = Awaited<ReturnType<typeof client.learn.submissions.start>>;
type SubmissionTask = SubmissionDetail["tasks"][number];

/**
 * The hand-in surface of an assignment lesson: the brief, one editor per task,
 * and whatever came back from the grader.
 *
 * `mySubmission` on the brief is a summary — it carries the status and the
 * grade but neither the overall feedback nor the per-task answers — so two more
 * reads sit alongside it: `submissions.listMine` for the feedback text and the
 * attempt history, and `submissions.get` for the answers themselves, so a
 * reload does not lose what the learner already wrote.
 */
export function AssignmentPanel({ lessonId, courseId }: { lessonId: string; courseId: string }) {
  const assignment = useQuery(
    orpc.learn.assignments.getForLesson.queryOptions({ input: { lessonId } }),
  );
  const assignmentId = assignment.data?.id;
  const attempts = useQuery({
    ...orpc.learn.submissions.listMine.queryOptions({
      input: { assignmentId: assignmentId ?? "" },
    }),
    enabled: Boolean(assignmentId),
  });

  const invalidateAssignments = useInvalidate(orpc.learn.assignments.key());
  const invalidateSubmissions = useInvalidate(orpc.learn.submissions.key());

  // The current attempt with its answers. Held as a query rather than as the
  // leftovers of whichever mutation ran last, so reopening the lesson shows the
  // draft the learner left behind.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const submissionId = openedId ?? assignment.data?.mySubmission?.id ?? null;
  const detailQuery = useQuery({
    ...orpc.learn.submissions.get.queryOptions({ input: { id: submissionId ?? "" } }),
    enabled: Boolean(submissionId),
  });
  const detail = detailQuery.data ?? null;

  const refresh = () => {
    invalidateAssignments();
    invalidateSubmissions();
  };

  const start = useMutation(
    orpc.learn.submissions.start.mutationOptions({
      onSuccess: (opened) => {
        // The brief's `mySubmission` only catches up after the refetch below;
        // remembering the id keeps the answers query pointed at the new attempt
        // in the meantime.
        setOpenedId(opened.id);
        refresh();
      },
      onError: toastError,
    }),
  );

  const saveTask = useMutation(
    orpc.learn.submissions.saveTask.mutationOptions({
      onSuccess: () => {
        void detailQuery.refetch();
        toast.success("Gespeichert.");
      },
      onError: toastError,
    }),
  );

  const submit = useMutation(
    orpc.learn.submissions.submit.mutationOptions({
      onSuccess: (handedIn) => {
        setOpenedId(handedIn.id);
        void detailQuery.refetch();
        refresh();
        toast.success(
          handedIn.status === "graded" ? "Abgegeben und bewertet." : "Abgabe eingegangen.",
        );
      },
      onError: toastError,
    }),
  );

  if (assignment.isError) {
    // A lesson whose brief is missing or still a draft answers NOT_FOUND, which
    // is a state of the course rather than a failure worth a retry button.
    if ((assignment.error as { code?: string }).code === "NOT_FOUND") {
      return (
        <Alert>
          <ClipboardList aria-hidden />
          <AlertTitle>Noch keine Aufgabe</AlertTitle>
          <AlertDescription>
            Für diese Lektion ist noch keine Aufgabe veröffentlicht.
          </AlertDescription>
        </Alert>
      );
    }
    return <QueryError error={assignment.error} onRetry={() => void assignment.refetch()} />;
  }
  if (assignment.isPending || !assignment.data) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const brief = assignment.data;
  const mine = brief.mySubmission;
  const history = attempts.data ?? [];
  const latest = history.find((row) => row.id === mine?.id) ?? history.at(-1) ?? null;
  const overdue = brief.dueAt !== null && brief.dueAt.getTime() < Date.now();
  const editable = detail !== null && (detail.status === "draft" || detail.status === "returned");
  const answersByTask = new Map(detail?.tasks.map((row) => [row.taskId, row]) ?? []);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold">{brief.title}</h3>
          {mine && <Badge variant="outline">{SUBMISSION_STATUS_LABEL[mine.status]}</Badge>}
          {mine?.isLate && <Badge variant="secondary">Verspätet abgegeben</Badge>}
        </div>

        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {brief.dueAt && (
            <div className="flex items-center gap-1.5">
              <CalendarClock className="size-4" aria-hidden />
              <dt className="sr-only">Abgabefrist</dt>
              <dd>Frist: {formatDateTime(brief.dueAt)}</dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt>Punkte:</dt>
            <dd>
              {brief.maxGrade} (bestanden ab {brief.passingGrade})
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Versuche:</dt>
            <dd>{brief.maxAttempts === null ? "unbegrenzt" : brief.maxAttempts}</dd>
          </div>
        </dl>

        <PageContent content={brief.instructions} fallbackText={brief.instructionsText} />

        {overdue && (
          <Alert variant={brief.allowLateSubmission ? "default" : "destructive"}>
            <CalendarClock aria-hidden />
            <AlertTitle>Die Frist ist abgelaufen</AlertTitle>
            <AlertDescription>
              {brief.allowLateSubmission
                ? "Du kannst noch abgeben — die Abgabe wird als verspätet markiert."
                : "Verspätete Abgaben nimmt diese Aufgabe nicht mehr an."}
            </AlertDescription>
          </Alert>
        )}
      </section>

      {latest && (latest.status === "graded" || latest.status === "returned") && (
        <Card className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">Bewertung</h4>
            {latest.passed !== null && (
              <Badge variant={latest.passed ? "default" : "outline"}>
                {latest.passed ? "Bestanden" : "Nicht bestanden"}
              </Badge>
            )}
          </div>
          {latest.score !== null && (
            <p className="text-2xl font-semibold tabular-nums">
              {latest.score} / {latest.maxScore ?? brief.maxGrade}
            </p>
          )}
          {latest.feedbackText && (
            <p className="text-sm whitespace-pre-wrap">{latest.feedbackText}</p>
          )}
          {latest.status === "returned" && (
            <p className="text-muted-foreground text-sm">
              Diese Abgabe wurde zur Überarbeitung zurückgegeben.
            </p>
          )}
        </Card>
      )}

      <section className="space-y-3">
        <h4 className="font-medium">Teilaufgaben</h4>
        <ol className="space-y-3">
          {brief.tasks.map((task, index) => (
            <li key={task.id}>
              <TaskCard
                // Remounting when the stored answer appears is what seeds the
                // textarea with a resumed draft: the card holds the draft text
                // locally so typing does not re-render the whole panel.
                key={answersByTask.get(task.id)?.id ?? task.id}
                index={index}
                task={task}
                answer={answersByTask.get(task.id) ?? null}
                courseId={courseId}
                editable={editable}
                onSaveText={(text) =>
                  detail &&
                  saveTask.mutate({
                    id: detail.id,
                    taskId: task.id,
                    contentText: text,
                    content: null,
                  })
                }
                onSaveAsset={(assetId) =>
                  detail && saveTask.mutate({ id: detail.id, taskId: task.id, assetId })
                }
                onSaveAttempt={(quizAttemptId) =>
                  detail && saveTask.mutate({ id: detail.id, taskId: task.id, quizAttemptId })
                }
                saving={saveTask.isPending}
              />
            </li>
          ))}
        </ol>
        {brief.tasks.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Diese Aufgabe hat noch keine Teilaufgaben.
          </p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <StartButton
          status={mine?.status ?? null}
          opened={detail !== null}
          pending={start.isPending}
          onStart={() => start.mutate({ assignmentId: brief.id })}
        />
        {editable && (
          <Button
            disabled={submit.isPending || (overdue && !brief.allowLateSubmission)}
            onClick={() => detail && submit.mutate({ id: detail.id })}
          >
            {submit.isPending ? "Wird abgegeben…" : "Abgeben"}
          </Button>
        )}
      </div>

      {history.length > 1 && (
        <section className="space-y-2">
          <h4 className="font-medium">Frühere Versuche</h4>
          <ul className="text-muted-foreground space-y-1 text-sm">
            {history.map((row) => (
              <li key={row.id}>
                Versuch {row.attemptNumber}: {SUBMISSION_STATUS_LABEL[row.status]}
                {row.score !== null ? ` — ${row.score} / ${row.maxScore ?? brief.maxGrade}` : ""}
                {row.submittedAt ? ` (${formatDateTime(row.submittedAt)})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The one button that opens an attempt. Its label is derived from the status of
 * the last hand-in rather than from an error: `start` resumes a draft, refuses a
 * submitted or graded one, and opens attempt N+1 on a returned one.
 */
function StartButton({
  status,
  opened,
  pending,
  onStart,
}: {
  status: string | null;
  opened: boolean;
  pending: boolean;
  onStart: () => void;
}) {
  if (status === "submitted") {
    return (
      <p className="text-muted-foreground text-sm">
        Deine Abgabe wartet auf die Bewertung durch das Kursteam.
      </p>
    );
  }
  if (status === "graded") {
    return <p className="text-muted-foreground text-sm">Diese Aufgabe ist abgeschlossen.</p>;
  }
  if (opened) return null;

  return (
    <Button
      variant={status === "draft" ? "default" : "outline"}
      disabled={pending}
      onClick={onStart}
    >
      {pending
        ? "Einen Moment…"
        : status === "draft"
          ? "Bearbeitung fortsetzen"
          : status === "returned"
            ? "Neuen Versuch starten"
            : "Bearbeitung starten"}
    </Button>
  );
}

/** One task of the brief, with the editor its kind calls for. */
function TaskCard({
  index,
  task,
  answer,
  courseId,
  editable,
  onSaveText,
  onSaveAsset,
  onSaveAttempt,
  saving,
}: {
  index: number;
  task: AssignmentTask;
  answer: SubmissionTask | null;
  courseId: string;
  editable: boolean;
  onSaveText: (text: string) => void;
  onSaveAsset: (assetId: string) => void;
  onSaveAttempt: (quizAttemptId: string) => void;
  saving: boolean;
}) {
  const [text, setText] = useState(answer?.contentText ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fieldId = `task-${task.id}`;
  const score = answer?.score ?? null;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      // Bytes cannot ride an RPC envelope, so hand-ins take the server's
      // multipart route; `credentials: "include"` because the session is a
      // cookie on another origin.
      const body = new FormData();
      body.set("file", file);
      body.set("courseId", courseId);
      body.set("kind", "submission");
      const response = await fetch(`${env.VITE_SERVER_URL}/course-assets/upload`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Upload fehlgeschlagen");
      }
      const asset = (await response.json()) as { id: string };
      onSaveAsset(asset.id);
    } catch (error) {
      toast.error(friendlyErrorMessage(error as Error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="font-medium">
          <span className="text-muted-foreground mr-2 text-xs tabular-nums">{index + 1}</span>
          {task.title}
        </h5>
        <span className="text-muted-foreground text-sm tabular-nums">
          {score !== null ? `${score} / ` : ""}
          {task.maxGrade} Punkte
        </span>
      </div>

      {task.description ? <PageContent content={task.description} fallbackText="" /> : null}

      {task.kind === "text" && (
        <div className="space-y-2">
          <Textarea
            id={fieldId}
            aria-label={`Antwort zu ${task.title}`}
            rows={6}
            value={text}
            disabled={!editable}
            onChange={(event) => setText(event.target.value)}
          />
          {editable && (
            <Button variant="outline" size="sm" disabled={saving} onClick={() => onSaveText(text)}>
              Entwurf speichern
            </Button>
          )}
        </div>
      )}

      {task.kind === "file" && (
        <div className="space-y-2">
          {answer?.assetId && (
            <a
              href={`${env.VITE_SERVER_URL}/course-assets/${answer.assetId}/download`}
              className="text-primary inline-flex items-center gap-1.5 text-sm hover:underline"
            >
              <Download className="size-4" aria-hidden />
              Hochgeladene Datei herunterladen
            </a>
          )}
          {editable && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                aria-label={`Datei für ${task.title} auswählen`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={uploading || saving}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp className="size-4" aria-hidden />
                {uploading
                  ? "Wird hochgeladen…"
                  : answer?.assetId
                    ? "Datei ersetzen"
                    : "Datei hochladen"}
              </Button>
            </>
          )}
        </div>
      )}

      {task.kind === "quiz" &&
        (task.quizId ? (
          <div className="space-y-2">
            {answer?.quizAttemptId && (
              <p className="text-muted-foreground text-sm">
                Ein Versuch ist dieser Teilaufgabe bereits zugeordnet.
              </p>
            )}
            <QuizRunner
              quizId={task.quizId}
              onAttemptFinished={(attempt) => editable && onSaveAttempt(attempt.id)}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Zu dieser Teilaufgabe ist kein Quiz hinterlegt.
          </p>
        ))}

      {answer?.feedback && (
        <>
          <Separator />
          <p className="text-sm whitespace-pre-wrap">
            <span className="text-muted-foreground">Rückmeldung: </span>
            {answer.feedback}
          </p>
        </>
      )}
    </Card>
  );
}

function formatDateTime(value: Date): string {
  return value.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
