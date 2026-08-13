import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, lt, max, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import {
  quiz,
  quizAttempt,
  quizOption,
  quizQuestion,
  quizResponse,
} from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { roleAllows } from "../lib/course-access";
import { generateKeyBetween } from "../lib/fractional";
import { requireCourseCapability, requireCourseLearn } from "../lib/learn-authz";
import { loadCourse, loadQuiz } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { gradeQuiz, type GradableQuestion } from "../lib/quiz-grading";
import { firstRow } from "../lib/rows";
import {
  AddOptionInputSchema,
  AddQuestionInputSchema,
  AttemptDetailSchema,
  CreateQuizInputSchema,
  ListAttemptsInputSchema,
  MoveQuestionInputSchema,
  QuizAttemptRowSchema,
  QuizDetailSchema,
  QuizSchema,
  StartAttemptInputSchema,
  StartAttemptResultSchema,
  SubmitAttemptInputSchema,
  UpdateOptionInputSchema,
  UpdateQuestionInputSchema,
  UpdateQuizInputSchema,
} from "../schemas/quiz";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Quizzes"];

export const quizRouter = {
  get: protectedProcedure
    .route({
      method: "GET",
      path: "/quizzes/{id}",
      tags: TAGS,
      summary: "Get a quiz with its questions",
    })
    .input(z.object({ id: IdSchema }))
    .output(QuizDetailSchema)
    .handler(async ({ input, context }) => {
      const quizRow = await loadQuiz(context.db, input.id);
      const courseRow = await loadCourse(context.db, quizRow.courseId);
      // A learner has to be able to open the quiz they are about to take, so
      // this is the one authoring surface gated on `learn` rather than `author`
      // — which is exactly why the answer key must be removed by shape below.
      const access = await requireCourseLearn(context.db, context, context.headers, courseRow);
      const questions = await loadQuestions(context.db, quizRow.id);

      // Any staff role sees the full quiz: a reviewer proofreading a question
      // needs to know which option is marked correct. Everyone else — every
      // enrolled learner, however far into the course — gets a projection that
      // has no `isCorrect` and no `acceptedAnswers` key at all. Filtering in the
      // client would put the answer key on the wire; this cannot.
      if (access.role !== null) {
        return {
          view: "full" as const,
          quiz: toQuiz(quizRow),
          questions: questions.map(toStaffQuestion),
        };
      }
      return {
        view: "redacted" as const,
        quiz: toQuiz(quizRow),
        // The explanation says *why* an answer is right, so it is withheld here
        // too and only reappears in `getAttempt` once the reveal rules allow it.
        questions: questions.map((row) => toLearnerQuestion(row)),
      };
    }),

  listForCourse: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/quizzes",
      tags: TAGS,
      summary: "List the quizzes of a course",
    })
    .input(z.object({ courseId: IdSchema }))
    .output(z.array(QuizSchema))
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      // Deliberately narrower than `get`: the list is the authoring index of a
      // course, not something a learner navigates.
      await requireCourseCapability(context.db, context, context.headers, courseRow, "author");
      const rows = await context.db.query.quiz.findMany({
        where: eq(quiz.courseId, courseRow.id),
        orderBy: [asc(quiz.createdAt)],
      });
      return rows.map(toQuiz);
    }),

  create: protectedProcedure
    .route({ method: "POST", path: "/quizzes", tags: TAGS, summary: "Create a quiz" })
    .input(CreateQuizInputSchema)
    .output(QuizSchema)
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "author");
      return context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .insert(quiz)
            .values({
              courseId: courseRow.id,
              title: input.title,
              description: input.description ?? null,
              passingPercent: input.passingPercent,
              maxAttempts: input.maxAttempts ?? null,
              timeLimitMinutes: input.timeLimitMinutes ?? null,
              shuffleQuestions: input.shuffleQuestions,
              shuffleOptions: input.shuffleOptions,
              answerReveal: input.answerReveal,
            })
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.created",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: row.id, title: row.title },
        });
        return toQuiz(row);
      });
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/quizzes/{id}", tags: TAGS, summary: "Update a quiz" })
    .input(UpdateQuizInputSchema)
    .output(QuizSchema)
    .handler(async ({ input, context }) => {
      const { course: courseRow } = await requireQuizCapability(context, input.id, "author");
      const { id, ...rest } = input;
      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(quiz)
            .set({
              ...(rest.title !== undefined ? { title: rest.title } : {}),
              ...(rest.description !== undefined ? { description: rest.description ?? null } : {}),
              ...(rest.passingPercent !== undefined ? { passingPercent: rest.passingPercent } : {}),
              ...(rest.maxAttempts !== undefined ? { maxAttempts: rest.maxAttempts ?? null } : {}),
              ...(rest.timeLimitMinutes !== undefined
                ? { timeLimitMinutes: rest.timeLimitMinutes ?? null }
                : {}),
              ...(rest.shuffleQuestions !== undefined
                ? { shuffleQuestions: rest.shuffleQuestions }
                : {}),
              ...(rest.shuffleOptions !== undefined ? { shuffleOptions: rest.shuffleOptions } : {}),
              ...(rest.answerReveal !== undefined ? { answerReveal: rest.answerReveal } : {}),
            })
            .where(eq(quiz.id, id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: updated.id, title: updated.title },
        });
        return toQuiz(updated);
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/quizzes/{id}",
      tags: TAGS,
      summary: "Delete a quiz with its questions and attempts",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const { quiz: quizRow, course: courseRow } = await requireQuizCapability(
        context,
        input.id,
        "author",
      );
      return context.db.transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.deleted",
          ...activityActor(context),
          courseId: courseRow.id,
          // Denormalized: the row is about to be gone and the FK nulls out.
          metadata: { quizId: quizRow.id, title: quizRow.title },
        });
        // Quizzes have no trash of their own; the cascade takes the questions,
        // options, attempts and responses with them.
        await tx.delete(quiz).where(eq(quiz.id, quizRow.id));
        return { id: quizRow.id };
      });
    }),

  // --- Questions -------------------------------------------------------------

  addQuestion: protectedProcedure
    .route({
      method: "POST",
      path: "/quizzes/{quizId}/questions",
      tags: TAGS,
      summary: "Add a question to a quiz",
    })
    .input(AddQuestionInputSchema)
    .output(QuizDetailSchema)
    .handler(async ({ input, context }) => {
      const { quiz: quizRow, course: courseRow } = await requireQuizCapability(
        context,
        input.quizId,
        "author",
      );
      const position = await positionAtEnd(context.db, quizRow.id);

      await context.db.transaction(async (tx) => {
        const question = firstRow(
          await tx
            .insert(quizQuestion)
            .values({
              quizId: quizRow.id,
              kind: input.kind,
              prompt: input.prompt ?? null,
              promptText: input.promptText,
              explanation: input.explanation ?? null,
              points: input.points,
              position,
              acceptedAnswers: input.acceptedAnswers ?? null,
            })
            .returning(),
        );
        // Options are seeded in the same transaction so a question of a choice
        // kind never exists in a half-authored, ungradable state.
        let optionPosition: string | null = null;
        for (const option of input.options ?? []) {
          optionPosition = generateKeyBetween(optionPosition, null);
          await tx.insert(quizOption).values({
            questionId: question.id,
            label: option.label,
            isCorrect: option.isCorrect,
            position: optionPosition,
          });
        }
        // The enum has no `quiz.question.*` action, so a change *inside* a quiz
        // is recorded as an update to the quiz with the detail in metadata —
        // the same shape `course.unpublish` uses.
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "question.added", questionId: question.id },
        });
      });

      return staffDetail(context.db, quizRow);
    }),

  updateQuestion: protectedProcedure
    .route({
      method: "PATCH",
      path: "/quiz-questions/{id}",
      tags: TAGS,
      summary: "Update a quiz question",
    })
    .input(UpdateQuestionInputSchema)
    .output(QuizDetailSchema)
    .handler(async ({ input, context }) => {
      const {
        question,
        quiz: quizRow,
        course: courseRow,
      } = await requireQuestionCapability(context, input.id, "author");
      const { id, ...rest } = input;
      await context.db.transaction(async (tx) => {
        await tx
          .update(quizQuestion)
          .set({
            ...(rest.kind !== undefined ? { kind: rest.kind } : {}),
            ...(rest.prompt !== undefined ? { prompt: rest.prompt ?? null } : {}),
            ...(rest.promptText !== undefined ? { promptText: rest.promptText } : {}),
            ...(rest.explanation !== undefined ? { explanation: rest.explanation ?? null } : {}),
            ...(rest.points !== undefined ? { points: rest.points } : {}),
            ...(rest.acceptedAnswers !== undefined
              ? { acceptedAnswers: rest.acceptedAnswers ?? null }
              : {}),
          })
          .where(eq(quizQuestion.id, id));
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "question.updated", questionId: question.id },
        });
      });
      return staffDetail(context.db, quizRow);
    }),

  moveQuestion: protectedProcedure
    .route({
      method: "POST",
      path: "/quiz-questions/{id}/move",
      tags: TAGS,
      summary: "Reorder a question within its quiz",
    })
    .input(MoveQuestionInputSchema)
    .output(QuizDetailSchema)
    .handler(async ({ input, context }) => {
      const {
        question,
        quiz: quizRow,
        course: courseRow,
      } = await requireQuestionCapability(context, input.id, "author");
      const position = await positionForMove(
        context.db,
        quizRow.id,
        question.id,
        input.beforeId,
        input.afterId,
      );
      await context.db.transaction(async (tx) => {
        await tx.update(quizQuestion).set({ position }).where(eq(quizQuestion.id, question.id));
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "question.moved", questionId: question.id },
        });
      });
      return staffDetail(context.db, quizRow);
    }),

  deleteQuestion: protectedProcedure
    .route({
      method: "DELETE",
      path: "/quiz-questions/{id}",
      tags: TAGS,
      summary: "Delete a quiz question",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const {
        question,
        quiz: quizRow,
        course: courseRow,
      } = await requireQuestionCapability(context, input.id, "author");
      return context.db.transaction(async (tx) => {
        await tx.delete(quizQuestion).where(eq(quizQuestion.id, question.id));
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "question.deleted", questionId: question.id },
        });
        return { id: question.id };
      });
    }),

  // --- Options ---------------------------------------------------------------

  addOption: protectedProcedure
    .route({
      method: "POST",
      path: "/quiz-questions/{questionId}/options",
      tags: TAGS,
      summary: "Add an answer option to a question",
    })
    .input(AddOptionInputSchema)
    .output(QuizDetailSchema)
    .handler(async ({ input, context }) => {
      const {
        question,
        quiz: quizRow,
        course: courseRow,
      } = await requireQuestionCapability(context, input.questionId, "author");
      const last = await context.db.query.quizOption.findFirst({
        where: eq(quizOption.questionId, question.id),
        orderBy: [desc(quizOption.position)],
        columns: { position: true },
      });
      const position = generateKeyBetween(last?.position ?? null, null);

      await context.db.transaction(async (tx) => {
        const option = firstRow(
          await tx
            .insert(quizOption)
            .values({
              questionId: question.id,
              label: input.label,
              isCorrect: input.isCorrect,
              position,
            })
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "option.added", optionId: option.id },
        });
      });
      return staffDetail(context.db, quizRow);
    }),

  updateOption: protectedProcedure
    .route({
      method: "PATCH",
      path: "/quiz-options/{id}",
      tags: TAGS,
      summary: "Update an answer option",
    })
    .input(UpdateOptionInputSchema)
    .output(QuizDetailSchema)
    .handler(async ({ input, context }) => {
      const {
        option,
        quiz: quizRow,
        course: courseRow,
      } = await requireOptionCapability(context, input.id, "author");
      await context.db.transaction(async (tx) => {
        await tx
          .update(quizOption)
          .set({
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.isCorrect !== undefined ? { isCorrect: input.isCorrect } : {}),
          })
          .where(eq(quizOption.id, option.id));
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "option.updated", optionId: option.id },
        });
      });
      return staffDetail(context.db, quizRow);
    }),

  deleteOption: protectedProcedure
    .route({
      method: "DELETE",
      path: "/quiz-options/{id}",
      tags: TAGS,
      summary: "Delete an answer option",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const {
        option,
        quiz: quizRow,
        course: courseRow,
      } = await requireOptionCapability(context, input.id, "author");
      return context.db.transaction(async (tx) => {
        await tx.delete(quizOption).where(eq(quizOption.id, option.id));
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "quiz.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { quizId: quizRow.id, change: "option.deleted", optionId: option.id },
        });
        return { id: option.id };
      });
    }),

  // --- Attempts --------------------------------------------------------------

  startAttempt: protectedProcedure
    .route({
      method: "POST",
      path: "/quizzes/{id}/attempts",
      tags: TAGS,
      summary: "Start an attempt at a quiz",
    })
    .input(StartAttemptInputSchema)
    .output(StartAttemptResultSchema)
    .handler(async ({ input, context }) => {
      const quizRow = await loadQuiz(context.db, input.id);
      const courseRow = await loadCourse(context.db, quizRow.courseId);
      // Taking a quiz is a learner act, so it goes through `learn` — a dropped
      // learner or a stranger with `page:*` rights gets nothing here.
      await requireCourseLearn(context.db, context, context.headers, courseRow);
      const userId = context.session.user.id;

      const [tally] = await context.db
        .select({ used: sql<number>`count(*)`, highest: max(quizAttempt.attemptNumber) })
        .from(quizAttempt)
        .where(and(eq(quizAttempt.quizId, quizRow.id), eq(quizAttempt.userId, userId)));
      const used = Number(tally?.used ?? 0);
      if (quizRow.maxAttempts !== null && used >= quizRow.maxAttempts) {
        throw new ORPCError("FORBIDDEN", {
          message: "You have used every attempt at this quiz",
        });
      }
      // Every started attempt counts, abandoned ones included — otherwise
      // closing the tab and reopening it would be an unlimited retake.
      const attemptNumber = Number(tally?.highest ?? 0) + 1;

      const attempt = await mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) =>
            firstRow(
              await tx
                .insert(quizAttempt)
                .values({
                  quizId: quizRow.id,
                  userId,
                  lessonId: input.lessonId ?? null,
                  attemptNumber,
                  // The clock is set here, server-side, so a time limit cannot
                  // be extended by a client that lies about when it began.
                  startedAt: new Date(),
                })
                .returning(),
            ),
          ),
        "Another attempt at this quiz was started at the same time — try again",
      );

      const questions = await loadQuestions(context.db, quizRow.id);
      const ordered = quizRow.shuffleQuestions ? shuffle(questions) : questions;
      return {
        attempt: toAttempt(attempt),
        quiz: toQuiz(quizRow),
        // The learner projection even for staff taking their own quiz: nothing
        // that leaves this endpoint may contain the answer key.
        questions: ordered.map((row) =>
          toLearnerQuestion(row, { shuffleOptions: quizRow.shuffleOptions }),
        ),
        deadline: deadlineOf(quizRow, attempt.startedAt),
      };
    }),

  submitAttempt: protectedProcedure
    .route({
      method: "POST",
      path: "/quiz-attempts/{id}/submit",
      tags: TAGS,
      summary: "Submit and score an attempt",
    })
    .input(SubmitAttemptInputSchema)
    .output(AttemptDetailSchema)
    .handler(async ({ input, context }) => {
      const attempt = await loadAttempt(context.db, input.id);
      // Only the learner who started it may hand it in — a grader marks an
      // attempt, they never answer one on someone else's behalf.
      if (attempt.userId !== context.session.user.id) throw new ORPCError("NOT_FOUND");
      if (attempt.submittedAt) {
        throw new ORPCError("CONFLICT", { message: "This attempt has already been submitted" });
      }
      const quizRow = await loadQuiz(context.db, attempt.quizId);
      const courseRow = await loadCourse(context.db, quizRow.courseId);
      const access = await requireCourseLearn(context.db, context, context.headers, courseRow);

      const deadline = deadlineOf(quizRow, attempt.startedAt);
      if (deadline && deadline.getTime() < Date.now()) {
        // Refused rather than scored: the answers arriving now were composed
        // with more time than the quiz allows, and accepting them would make
        // the limit advisory. The row stays unsubmitted and still counts
        // against `maxAttempts`, which is what makes running out the clock a
        // cost rather than a strategy.
        throw new ORPCError("BAD_REQUEST", {
          message: "The time limit for this attempt has elapsed",
        });
      }

      const questions = await loadQuestions(context.db, quizRow.id);
      const graded = gradeQuiz({
        questions: questions.map(toGradable),
        responses: input.responses.map((response) => ({
          questionId: response.questionId,
          selectedOptionIds: response.selectedOptionIds ?? [],
          textAnswer: response.textAnswer ?? null,
        })),
        passingPercent: quizRow.passingPercent,
      });
      const answers = new Map(input.responses.map((response) => [response.questionId, response]));

      const submitted = await context.db.transaction(async (tx) => {
        const rows = await tx
          .update(quizAttempt)
          .set({
            score: graded.score,
            maxScore: graded.maxScore,
            passed: graded.passed,
            submittedAt: new Date(),
          })
          // Re-checking `submittedAt` inside the write is what stops two
          // concurrent submits from both scoring and doubling the responses;
          // the read above only catches the non-racing case.
          .where(and(eq(quizAttempt.id, attempt.id), sql`${quizAttempt.submittedAt} is null`))
          .returning();
        const row = rows[0];
        if (!row) {
          throw new ORPCError("CONFLICT", { message: "This attempt has already been submitted" });
        }
        for (const result of graded.results) {
          const answer = answers.get(result.questionId);
          await tx.insert(quizResponse).values({
            attemptId: row.id,
            questionId: result.questionId,
            selectedOptionIds: answer?.selectedOptionIds ?? [],
            textAnswer: answer?.textAnswer ?? null,
            isCorrect: result.isCorrect,
            pointsAwarded: result.pointsAwarded,
          });
        }
        return row;
      });

      // Deliberately no `recordActivity`: the audit log records what authors did
      // to the course, and a learner's attempt is coursework, not an audit event.
      return attemptDetail(context.db, submitted, quizRow, questions, {
        staff: roleAllows(access.role, "grade"),
      });
    }),

  getAttempt: protectedProcedure
    .route({
      method: "GET",
      path: "/quiz-attempts/{id}",
      tags: TAGS,
      summary: "Get one attempt with its responses",
    })
    .input(z.object({ id: IdSchema }))
    .output(AttemptDetailSchema)
    .handler(async ({ input, context }) => {
      const attempt = await loadAttempt(context.db, input.id);
      const quizRow = await loadQuiz(context.db, attempt.quizId);
      const courseRow = await loadCourse(context.db, quizRow.courseId);
      const isOwner = attempt.userId === context.session.user.id;

      // The owner reaches their own attempt through `learn`, so a dropped
      // learner loses it with the rest of the course. Anyone else must be able
      // to mark it.
      const access = isOwner
        ? await requireCourseLearn(context.db, context, context.headers, courseRow)
        : await requireCourseCapability(context.db, context, context.headers, courseRow, "grade");

      const questions = await loadQuestions(context.db, quizRow.id);
      // A grader who cannot see which answer was correct cannot grade, so staff
      // get the full projection whatever `answerReveal` says — that setting
      // governs what the *learner* is shown, not what staff may inspect. Which
      // is also why it is keyed on the capability and not on `!isOwner`: an
      // instructor taking their own quiz is still staff.
      return attemptDetail(context.db, attempt, quizRow, questions, {
        staff: roleAllows(access.role, "grade"),
      });
    }),

  listAttempts: protectedProcedure
    .route({
      method: "GET",
      path: "/quizzes/{id}/attempts",
      tags: TAGS,
      summary: "List every learner's attempts at a quiz",
    })
    .input(ListAttemptsInputSchema)
    .output(z.array(QuizAttemptRowSchema))
    .handler(async ({ input, context }) => {
      const { quiz: quizRow } = await requireQuizCapability(context, input.id, "grade");
      const rows = await context.db.query.quizAttempt.findMany({
        where: and(
          eq(quizAttempt.quizId, quizRow.id),
          input.userId ? eq(quizAttempt.userId, input.userId) : undefined,
        ),
        orderBy: [desc(quizAttempt.startedAt)],
        limit: input.limit,
        offset: input.offset,
        with: { user: { columns: { id: true, name: true, image: true } } },
      });
      return rows.map((row) => ({
        ...toAttempt(row),
        user: row.user ? { ...row.user, image: row.user.image ?? null } : null,
      }));
    }),
};

// ---------------------------------------------------------------------------
// Loaders
//
// `learn-loaders.ts` only knows about the quiz itself, so the three rows below
// get local loaders with the same contract: NOT_FOUND rather than null.
// ---------------------------------------------------------------------------

async function loadQuestion(db: Database, id: string) {
  const row = await db.query.quizQuestion.findFirst({ where: eq(quizQuestion.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Question not found" });
  return row;
}

async function loadOption(db: Database, id: string) {
  const row = await db.query.quizOption.findFirst({ where: eq(quizOption.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Option not found" });
  return row;
}

async function loadAttempt(db: Database, id: string) {
  const row = await db.query.quizAttempt.findFirst({ where: eq(quizAttempt.id, id) });
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Attempt not found" });
  return row;
}

/** A quiz's questions with their options, both in authored order. */
async function loadQuestions(db: Database, quizId: string) {
  return db.query.quizQuestion.findMany({
    where: eq(quizQuestion.quizId, quizId),
    orderBy: [asc(quizQuestion.position)],
    with: { options: { orderBy: [asc(quizOption.position)] } },
  });
}

type QuestionWithOptions = Awaited<ReturnType<typeof loadQuestions>>[number];

// ---------------------------------------------------------------------------
// Gates
//
// A quiz has no access rules of its own: it inherits its course's entirely,
// which is why every gate walks row → quiz → course before asking. The chain is
// the same one `requireChapterCapability` follows for chapters and lessons.
// ---------------------------------------------------------------------------

async function requireQuizCapability(
  context: AuthedContext,
  quizId: string,
  capability: "grade" | "author" | "manage",
) {
  const quizRow = await loadQuiz(context.db, quizId);
  const courseRow = await loadCourse(context.db, quizRow.courseId);
  await requireCourseCapability(context.db, context, context.headers, courseRow, capability);
  return { quiz: quizRow, course: courseRow };
}

async function requireQuestionCapability(
  context: AuthedContext,
  questionId: string,
  capability: "grade" | "author" | "manage",
) {
  const question = await loadQuestion(context.db, questionId);
  const { quiz: quizRow, course } = await requireQuizCapability(
    context,
    question.quizId,
    capability,
  );
  return { question, quiz: quizRow, course };
}

async function requireOptionCapability(
  context: AuthedContext,
  optionId: string,
  capability: "grade" | "author" | "manage",
) {
  const option = await loadOption(context.db, optionId);
  const {
    question,
    quiz: quizRow,
    course,
  } = await requireQuestionCapability(context, option.questionId, capability);
  return { option, question, quiz: quizRow, course };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

async function positionAtEnd(db: Database, quizId: string, excludeId?: string): Promise<string> {
  const last = await db.query.quizQuestion.findFirst({
    where: excludeId
      ? and(eq(quizQuestion.quizId, quizId), sql`${quizQuestion.id} <> ${excludeId}`)
      : eq(quizQuestion.quizId, quizId),
    orderBy: [desc(quizQuestion.position)],
    columns: { position: true },
  });
  return generateKeyBetween(last?.position ?? null, null);
}

/**
 * The question a reorder anchors against, checked to be in the same quiz.
 * Without the check a client could anchor against a question in someone else's
 * course: the move would succeed with a meaningless position, and the endpoint
 * would double as an existence oracle for ids it may not see.
 */
async function loadSibling(db: Database, id: string, quizId: string) {
  const row = await loadQuestion(db, id);
  if (row.quizId !== quizId) {
    throw new ORPCError("BAD_REQUEST", { message: "That question is not in this quiz" });
  }
  return row;
}

/** Resolves a reorder request into a fractional position within the quiz. */
async function positionForMove(
  db: Database,
  quizId: string,
  movedId: string,
  beforeId?: string,
  afterId?: string,
): Promise<string> {
  const not = sql`${quizQuestion.id} <> ${movedId}`;
  if (afterId) {
    const anchor = await loadSibling(db, afterId, quizId);
    const next = await db.query.quizQuestion.findFirst({
      where: and(eq(quizQuestion.quizId, quizId), gt(quizQuestion.position, anchor.position), not),
      orderBy: [asc(quizQuestion.position)],
      columns: { position: true },
    });
    return generateKeyBetween(anchor.position, next?.position ?? null);
  }
  if (beforeId) {
    const anchor = await loadSibling(db, beforeId, quizId);
    const prev = await db.query.quizQuestion.findFirst({
      where: and(eq(quizQuestion.quizId, quizId), lt(quizQuestion.position, anchor.position), not),
      orderBy: [desc(quizQuestion.position)],
      columns: { position: true },
    });
    return generateKeyBetween(prev?.position ?? null, anchor.position);
  }
  return positionAtEnd(db, quizId, movedId);
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

function toQuiz(row: Awaited<ReturnType<typeof loadQuiz>>) {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    description: row.description,
    passingPercent: row.passingPercent,
    maxAttempts: row.maxAttempts,
    timeLimitMinutes: row.timeLimitMinutes,
    shuffleQuestions: row.shuffleQuestions,
    shuffleOptions: row.shuffleOptions,
    answerReveal: row.answerReveal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAttempt(row: Awaited<ReturnType<typeof loadAttempt>>) {
  return {
    id: row.id,
    quizId: row.quizId,
    userId: row.userId,
    lessonId: row.lessonId,
    attemptNumber: row.attemptNumber,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    score: row.score,
    maxScore: row.maxScore,
    passed: row.passed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The full question, answer key included. Staff and post-reveal only. */
function toStaffQuestion(row: QuestionWithOptions) {
  return {
    id: row.id,
    quizId: row.quizId,
    kind: row.kind,
    prompt: row.prompt,
    promptText: row.promptText,
    points: row.points,
    position: row.position,
    explanation: row.explanation,
    acceptedAnswers: row.acceptedAnswers,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    options: row.options.map((option) => ({
      id: option.id,
      questionId: option.questionId,
      label: option.label,
      position: option.position,
      isCorrect: option.isCorrect,
      createdAt: option.createdAt,
    })),
  };
}

/**
 * The question as a learner may receive it. There is no `isCorrect`, no
 * `acceptedAnswers` and no `explanation` key to forget to strip — that is the
 * whole point of having a second mapper instead of a conditional delete. The
 * explanation ships only in the full projection, once the reveal rules allow it.
 */
function toLearnerQuestion(row: QuestionWithOptions, options: { shuffleOptions?: boolean } = {}) {
  const rendered = options.shuffleOptions ? shuffle(row.options) : row.options;
  return {
    id: row.id,
    quizId: row.quizId,
    kind: row.kind,
    prompt: row.prompt,
    promptText: row.promptText,
    points: row.points,
    position: row.position,
    options: rendered.map((option) => ({
      id: option.id,
      questionId: option.questionId,
      label: option.label,
      position: option.position,
    })),
  };
}

/** The learner's own answer, with the verdict removed by shape. */
function toLearnerResponse(row: {
  id: string;
  attemptId: string;
  questionId: string;
  selectedOptionIds: unknown;
  textAnswer: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    attemptId: row.attemptId,
    questionId: row.questionId,
    selectedOptionIds: stringArray(row.selectedOptionIds),
    textAnswer: row.textAnswer,
    createdAt: row.createdAt,
  };
}

/** Reloads a quiz's questions and returns the staff detail after a mutation. */
async function staffDetail(db: Database, quizRow: Awaited<ReturnType<typeof loadQuiz>>) {
  const questions = await loadQuestions(db, quizRow.id);
  return {
    view: "full" as const,
    quiz: toQuiz(quizRow),
    questions: questions.map(toStaffQuestion),
  };
}

/**
 * One attempt with its responses, projected according to who is asking.
 *
 * `answerReveal` is evaluated against the attempt's *state*, not only its own
 * value: `after_attempt` on an unsubmitted attempt would otherwise let a
 * learner start a run and immediately read the answer key back out of it.
 */
async function attemptDetail(
  db: Database,
  attempt: Awaited<ReturnType<typeof loadAttempt>>,
  quizRow: Awaited<ReturnType<typeof loadQuiz>>,
  questions: QuestionWithOptions[],
  options: { staff: boolean },
) {
  const rows = await db.query.quizResponse.findMany({
    where: eq(quizResponse.attemptId, attempt.id),
  });

  const scored = attempt.submittedAt !== null;
  const reveal =
    quizRow.answerReveal === "never"
      ? false
      : quizRow.answerReveal === "after_pass"
        ? scored && attempt.passed
        : scored;

  if (options.staff || reveal) {
    return {
      view: "full" as const,
      attempt: toAttempt(attempt),
      quiz: toQuiz(quizRow),
      questions: questions.map(toStaffQuestion),
      // `isCorrect` per question is only ever attached on this branch: telling
      // a learner "the option you picked was the right one" names the right
      // option, so it is answer-key material like the options themselves.
      responses: rows.map((row) => ({
        ...toLearnerResponse(row),
        isCorrect: row.isCorrect,
        pointsAwarded: row.pointsAwarded,
      })),
    };
  }

  return {
    view: "redacted" as const,
    attempt: toAttempt(attempt),
    quiz: toQuiz(quizRow),
    questions: questions.map((row) => toLearnerQuestion(row)),
    responses: rows.map(toLearnerResponse),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The answer key in the shape `gradeQuiz` grades against. */
function toGradable(row: QuestionWithOptions): GradableQuestion {
  return {
    id: row.id,
    kind: row.kind,
    points: row.points,
    correctOptionIds: row.options.filter((option) => option.isCorrect).map((option) => option.id),
    acceptedAnswers: stringArray(row.acceptedAnswers),
  };
}

/**
 * Narrows a `jsonb` column back to the string array it was written as. Postgres
 * hands these back as `unknown`, and a column written before a schema change
 * could hold anything, so the shape is checked rather than asserted.
 */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** The absolute deadline of an attempt, or null when the quiz is untimed. */
function deadlineOf(quizRow: Awaited<ReturnType<typeof loadQuiz>>, startedAt: Date): Date | null {
  if (quizRow.timeLimitMinutes === null) return null;
  return new Date(startedAt.getTime() + quizRow.timeLimitMinutes * 60_000);
}

/**
 * Fisher-Yates on a copy. Shuffling lives here rather than in `quiz-grading.ts`
 * because it is a presentation decision — keeping `Math.random` out of the
 * grader is what lets the grader be pinned by a unit test.
 */
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
