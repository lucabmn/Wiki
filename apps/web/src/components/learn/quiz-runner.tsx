import { PageContent } from "@/components/editor/page-content";
import { QueryError } from "@/components/query-error";
import { toastError } from "@/lib/query";
import { client, friendlyErrorMessage, orpc } from "@/utils/orpc";
import { Alert, AlertDescription, AlertTitle } from "@nilovon-wiki/ui/components/alert";
import { Badge } from "@nilovon-wiki/ui/components/badge";
import { Button } from "@nilovon-wiki/ui/components/button";
import { Card } from "@nilovon-wiki/ui/components/card";
import { Checkbox } from "@nilovon-wiki/ui/components/checkbox";
import { Input } from "@nilovon-wiki/ui/components/input";
import { Label } from "@nilovon-wiki/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@nilovon-wiki/ui/components/radio-group";
import { Separator } from "@nilovon-wiki/ui/components/separator";
import { Skeleton } from "@nilovon-wiki/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type StartedAttempt = Awaited<ReturnType<typeof client.learn.quizzes.startAttempt>>;
type AttemptDetail = Awaited<ReturnType<typeof client.learn.quizzes.submitAttempt>>;
type Answer = { optionIds: string[]; text: string };

const EMPTY_ANSWER: Answer = { optionIds: [], text: "" };

/**
 * Takes one quiz: the briefing, the attempt, and the result.
 *
 * An attempt is started by an explicit click and never from an effect. The
 * server counts every started attempt against `maxAttempts`, abandoned ones
 * included, so a mount-time start would burn a retake on each visit — twice
 * over in React's development double-render.
 *
 * The result is rendered off the `view` discriminant rather than by probing for
 * fields. The learner projection is a different branch of the union with no
 * `isCorrect` key at all, so "the server did not reveal the answers" and "the
 * answer happened to be wrong" cannot be confused for one another.
 */
export function QuizRunner({
  quizId,
  lessonId,
  onAttemptFinished,
}: {
  quizId: string;
  /** Attributes the attempt to the lesson it was taken in, when there is one. */
  lessonId?: string;
  /** Lets an assignment hand the finished attempt in as its answer. */
  onAttemptFinished?: (attempt: { id: string; passed: boolean }) => void;
}) {
  const detail = useQuery(orpc.learn.quizzes.get.queryOptions({ input: { id: quizId } }));
  const [attempt, setAttempt] = useState<StartedAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<AttemptDetail | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const start = useMutation(
    orpc.learn.quizzes.startAttempt.mutationOptions({
      onSuccess: (started) => {
        setAttempt(started);
        setAnswers({});
        setResult(null);
        setRefusal(null);
      },
      onError: (error) => {
        // A learner cannot count their own attempts — listing them needs the
        // grading capability — so the refusal is the only signal there is, and
        // the generic "Dafür fehlt dir die Berechtigung" would misname it.
        setRefusal(
          (error as { code?: string }).code === "FORBIDDEN"
            ? "Du hast alle Versuche für dieses Quiz aufgebraucht."
            : friendlyErrorMessage(error),
        );
      },
    }),
  );

  const submit = useMutation(
    orpc.learn.quizzes.submitAttempt.mutationOptions({
      onSuccess: (scored) => {
        setResult(scored);
        setAttempt(null);
        onAttemptFinished?.({ id: scored.attempt.id, passed: scored.attempt.passed });
      },
      onError: toastError,
    }),
  );

  if (detail.isError) {
    return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (detail.isPending || !detail.data) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  const quiz = detail.data.quiz;

  if (result) {
    return (
      <QuizResult
        result={result}
        onRetry={
          quiz.maxAttempts === null || result.attempt.attemptNumber < quiz.maxAttempts
            ? () => start.mutate({ id: quizId, lessonId: lessonId ?? null })
            : null
        }
        retrying={start.isPending}
      />
    );
  }

  if (attempt) {
    return (
      <AttemptForm
        attempt={attempt}
        answers={answers}
        onAnswer={(questionId, answer) =>
          setAnswers((previous) => ({ ...previous, [questionId]: answer }))
        }
        onSubmit={() =>
          submit.mutate({
            id: attempt.attempt.id,
            responses: attempt.questions.map((question) => {
              const answer = answers[question.id] ?? EMPTY_ANSWER;
              return {
                questionId: question.id,
                selectedOptionIds: answer.optionIds,
                textAnswer: answer.text.trim() || null,
              };
            }),
          })
        }
        submitting={submit.isPending}
      />
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{quiz.title}</h3>
        {quiz.description && <p className="text-muted-foreground text-sm">{quiz.description}</p>}
      </div>

      <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1.5">
          <dt>Bestehensgrenze:</dt>
          <dd>{quiz.passingPercent} %</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Versuche:</dt>
          <dd>{quiz.maxAttempts === null ? "unbegrenzt" : quiz.maxAttempts}</dd>
        </div>
        {quiz.timeLimitMinutes !== null && (
          <div className="flex gap-1.5">
            <dt>Zeitlimit:</dt>
            <dd>{quiz.timeLimitMinutes} Min.</dd>
          </div>
        )}
      </dl>

      {refusal && (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Kein Versuch möglich</AlertTitle>
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}

      <Button
        disabled={start.isPending}
        onClick={() => start.mutate({ id: quizId, lessonId: lessonId ?? null })}
      >
        {start.isPending ? "Einen Moment…" : "Quiz starten"}
      </Button>
      {quiz.maxAttempts !== null && (
        <p className="text-muted-foreground text-xs">
          Jeder gestartete Versuch zählt — auch ein abgebrochener.
        </p>
      )}
    </Card>
  );
}

/** The running attempt: every question, plus the deadline when there is one. */
function AttemptForm({
  attempt,
  answers,
  onAnswer,
  onSubmit,
  submitting,
}: {
  attempt: StartedAttempt;
  answers: Record<string, Answer>;
  onAnswer: (questionId: string, answer: Answer) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const remaining = useCountdown(attempt.deadline);
  const expired = remaining !== null && remaining <= 0;

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{attempt.quiz.title}</h3>
        <p className="text-muted-foreground text-sm">Versuch {attempt.attempt.attemptNumber}</p>
      </div>

      {remaining !== null && (
        <Alert variant={expired ? "destructive" : "default"}>
          <Clock aria-hidden />
          <AlertTitle>
            {expired ? "Zeit abgelaufen" : `Verbleibend: ${formatClock(remaining)}`}
          </AlertTitle>
          <AlertDescription>
            {expired
              ? "Die Zeit für diesen Versuch ist vorbei — der Server nimmt die Antworten nicht mehr an."
              : "Der Server misst die Zeit; diese Anzeige ist nur eine Hilfe."}
          </AlertDescription>
        </Alert>
      )}

      <ol className="space-y-4">
        {attempt.questions.map((question, index) => {
          const answer = answers[question.id] ?? EMPTY_ANSWER;
          const legendId = `question-${question.id}`;
          return (
            <li key={question.id}>
              <Card className="space-y-3 p-4">
                {/* A `group` with `aria-labelledby` rather than fieldset/legend:
                    the prompt is rich text, and a legend may only hold phrasing
                    content — a serialized TipTap document is not that. */}
                <div role="group" aria-labelledby={legendId}>
                  <div id={legendId} className="space-y-1">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      Frage {index + 1} von {attempt.questions.length} · {question.points}{" "}
                      {question.points === 1 ? "Punkt" : "Punkte"}
                    </span>
                    <PageContent content={question.prompt} fallbackText={question.promptText} />
                  </div>

                  {question.kind === "multiple_choice" ? (
                    <div className="mt-3 space-y-2">
                      {question.options.map((option) => (
                        <Label
                          key={option.id}
                          htmlFor={option.id}
                          className="cursor-pointer items-start gap-2 font-normal"
                        >
                          <Checkbox
                            id={option.id}
                            checked={answer.optionIds.includes(option.id)}
                            onCheckedChange={(checked) =>
                              onAnswer(question.id, {
                                ...answer,
                                optionIds:
                                  checked === true
                                    ? [...answer.optionIds, option.id]
                                    : answer.optionIds.filter((id) => id !== option.id),
                              })
                            }
                          />
                          <span>{option.label}</span>
                        </Label>
                      ))}
                    </div>
                  ) : question.kind === "short_answer" ? (
                    <Input
                      className="mt-3"
                      aria-labelledby={legendId}
                      value={answer.text}
                      onChange={(event) =>
                        onAnswer(question.id, { ...answer, text: event.target.value })
                      }
                    />
                  ) : (
                    <RadioGroup
                      className="mt-3"
                      aria-labelledby={legendId}
                      value={answer.optionIds[0] ?? ""}
                      onValueChange={(value: string) =>
                        onAnswer(question.id, { ...answer, optionIds: [value] })
                      }
                    >
                      {question.options.map((option) => (
                        <Label
                          key={option.id}
                          htmlFor={option.id}
                          className="cursor-pointer items-start gap-2 font-normal"
                        >
                          <RadioGroupItem id={option.id} value={option.id} />
                          <span>{option.label}</span>
                        </Label>
                      ))}
                    </RadioGroup>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <Button type="submit" disabled={submitting || expired}>
        {submitting ? "Wird abgegeben…" : "Antworten abgeben"}
      </Button>
    </form>
  );
}

/** The scored attempt, with per-question feedback only where the server sent it. */
function QuizResult({
  result,
  onRetry,
  retrying,
}: {
  result: AttemptDetail;
  onRetry: (() => void) | null;
  retrying: boolean;
}) {
  const { attempt, quiz } = result;
  const percent = attempt.maxScore > 0 ? Math.round((attempt.score / attempt.maxScore) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold">{quiz.title}</h3>
          <Badge variant={attempt.passed ? "default" : "outline"}>
            {attempt.passed ? "Bestanden" : "Nicht bestanden"}
          </Badge>
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          {attempt.score} / {attempt.maxScore}
          <span className="text-muted-foreground ml-2 text-base font-normal">({percent} %)</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Zum Bestehen nötig: {quiz.passingPercent} % · Versuch {attempt.attemptNumber}
          {quiz.maxAttempts !== null ? ` von ${quiz.maxAttempts}` : ""}
        </p>
        {onRetry && (
          <Button variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying ? "Einen Moment…" : "Neuer Versuch"}
          </Button>
        )}
      </Card>

      {result.view === "full" ? (
        <ol className="space-y-3">
          {result.questions.map((question) => {
            const response = result.responses.find((row) => row.questionId === question.id);
            return (
              <li key={question.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex items-start gap-2">
                    {response?.isCorrect ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        aria-label="Richtig"
                      />
                    ) : (
                      <XCircle
                        className="text-destructive mt-0.5 size-4 shrink-0"
                        aria-label="Falsch"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <PageContent content={question.prompt} fallbackText={question.promptText} />
                    </div>
                    <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                      {response?.pointsAwarded ?? 0} / {question.points}
                    </span>
                  </div>

                  {question.options.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {question.options.map((option) => {
                        const chosen = response?.selectedOptionIds.includes(option.id) ?? false;
                        return (
                          <li
                            key={option.id}
                            className={
                              option.isCorrect
                                ? "font-medium text-emerald-700 dark:text-emerald-500"
                                : chosen
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                            }
                          >
                            {option.label}
                            {option.isCorrect && (
                              <span className="sr-only"> — richtige Antwort</span>
                            )}
                            {chosen && <span className="sr-only"> — von dir gewählt</span>}
                            {chosen ? " ✓" : ""}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {question.kind === "short_answer" && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Deine Antwort: </span>
                      {response?.textAnswer || "—"}
                    </p>
                  )}

                  {question.explanation && (
                    <>
                      <Separator />
                      <p className="text-muted-foreground text-sm">{question.explanation}</p>
                    </>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">
          Für dieses Quiz werden die richtigen Antworten nicht angezeigt.
        </p>
      )}
    </div>
  );
}

/** Milliseconds left until `deadline`, ticking once a second; null when untimed. */
function useCountdown(deadline: Date | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  if (!deadline) return null;
  return deadline.getTime() - now;
}

function formatClock(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
