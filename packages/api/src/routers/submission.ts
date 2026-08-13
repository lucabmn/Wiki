import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import {
  assignmentTask,
  quizAttempt,
  submission,
  submissionGrade,
  submissionTask,
} from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requireCourseCapability, requireCourseLearn } from "../lib/learn-authz";
import {
  loadAssignment,
  loadCourse,
  loadCourseAsset,
  loadLesson,
  loadSubmission,
  type AssignmentRow,
} from "../lib/learn-loaders";
import { firstRow } from "../lib/rows";
import {
  GradeSubmissionInputSchema,
  ListMySubmissionsInputSchema,
  ListSubmissionsInputSchema,
  ReturnSubmissionInputSchema,
  SaveSubmissionTaskInputSchema,
  StartSubmissionInputSchema,
  SubmissionDetailSchema,
  SubmissionListItemSchema,
  SubmissionSchema,
  SubmissionTaskSchema,
} from "../schemas/assignment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Submissions"];

/** Statuses the learner may still write to; everything else is out of their hands. */
const EDITABLE = ["draft", "returned"] as const;

export const submissionRouter = {
  listMine: protectedProcedure
    .route({
      method: "GET",
      path: "/submissions/mine",
      tags: TAGS,
      summary: "List the caller's own attempts at an assignment",
    })
    .input(ListMySubmissionsInputSchema)
    .output(z.array(SubmissionSchema))
    .handler(async ({ input, context }) => {
      const assignment = await loadAssignment(context.db, input.assignmentId);
      const course = await loadCourse(context.db, assignment.courseId);
      await requireCourseLearn(context.db, context, context.headers, course);
      return context.db.query.submission.findMany({
        where: and(
          eq(submission.assignmentId, assignment.id),
          eq(submission.userId, context.session.user.id),
        ),
        orderBy: [asc(submission.attemptNumber)],
      });
    }),

  listForAssignment: protectedProcedure
    .route({
      method: "GET",
      path: "/assignments/{assignmentId}/submissions",
      tags: TAGS,
      summary: "List everything handed in for an assignment (the grading queue)",
    })
    .input(ListSubmissionsInputSchema)
    .output(z.array(SubmissionListItemSchema))
    .handler(async ({ input, context }) => {
      const assignment = await loadAssignment(context.db, input.assignmentId);
      const course = await loadCourse(context.db, assignment.courseId);
      await requireCourseCapability(context.db, context, context.headers, course, "grade");

      const rows = await context.db.query.submission.findMany({
        where: and(
          eq(submission.assignmentId, assignment.id),
          // A draft is the learner's own workspace — it stays out of the queue
          // until they hand it in, even for a grader asking for everything.
          input.status
            ? eq(submission.status, input.status)
            : inArray(submission.status, ["submitted", "returned", "graded"]),
        ),
        with: { user: { columns: { id: true, name: true, image: true } } },
        orderBy: [desc(submission.submittedAt), desc(submission.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return rows.map((row) => {
        // Blind grading withholds the submitter until a grade exists — the point
        // of the flag is that the grader forms the judgement without knowing
        // whose work it is. `gradedAt` rather than the status, because a graded
        // hand-in sent back for rework must not go anonymous again.
        const hidden = assignment.blindGrading && row.gradedAt === null;
        return {
          ...row,
          userId: hidden ? null : row.userId,
          user: hidden ? null : (row.user ?? null),
        };
      });
    }),

  start: protectedProcedure
    .route({
      method: "POST",
      path: "/submissions",
      tags: TAGS,
      summary: "Open (or resume) an attempt at an assignment",
    })
    .input(StartSubmissionInputSchema)
    .output(SubmissionDetailSchema)
    .handler(async ({ input, context }) => {
      const assignment = await loadAssignment(context.db, input.assignmentId);
      const course = await loadCourse(context.db, assignment.courseId);
      const access = await requireCourseLearn(context.db, context, context.headers, course);
      if (!assignment.publishedAt) {
        // Nobody hands in against a draft brief, staff included: its tasks and
        // its total grade can still change underneath the attempt.
        throw new ORPCError("BAD_REQUEST", { message: "This assignment is not published yet" });
      }
      // A published assignment can still hang off an unpublished lesson while an
      // author works. The read paths hide it; writing to it must not be the way
      // back in.
      const lesson = await loadLesson(context.db, assignment.lessonId);
      if (!access.role && !lesson.publishedAt) {
        throw new ORPCError("NOT_FOUND", { message: "Assignment not found" });
      }

      const userId = context.session.user.id;
      const latest = await context.db.query.submission.findFirst({
        where: and(eq(submission.assignmentId, assignment.id), eq(submission.userId, userId)),
        orderBy: [desc(submission.attemptNumber)],
      });

      // Resuming beats creating: a learner who reopens the page must land back
      // in the draft they already typed into, not next to it.
      if (latest?.status === "draft") return withTasks(context.db, latest);
      if (latest?.status === "submitted") {
        throw new ORPCError("CONFLICT", {
          message: "Your last attempt is waiting to be graded",
        });
      }
      if (latest?.status === "graded") {
        // A grade is the end of the line; only a grader returning the work
        // reopens it, which is what `returned` below allows.
        throw new ORPCError("CONFLICT", { message: "This assignment has already been graded" });
      }
      if (
        latest &&
        assignment.maxAttempts !== null &&
        latest.attemptNumber >= assignment.maxAttempts
      ) {
        throw new ORPCError("CONFLICT", { message: "No attempts left for this assignment" });
      }

      return context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .insert(submission)
            .values({
              assignmentId: assignment.id,
              userId,
              attemptNumber: (latest?.attemptNumber ?? 0) + 1,
              status: "draft",
            })
            .returning(),
        );
        // No activity row: a draft only the learner can see is not an event the
        // course has happened yet. `submission.submitted` is where it starts.
        return { ...row, tasks: [] };
      });
    }),

  saveTask: protectedProcedure
    .route({
      method: "PUT",
      path: "/submissions/{id}/tasks/{taskId}",
      tags: TAGS,
      summary: "Write the learner's answer to one task",
    })
    .input(SaveSubmissionTaskInputSchema)
    .output(SubmissionTaskSchema)
    .handler(async ({ input, context }) => {
      const { submission: row, assignment, course } = await requireOwnSubmission(context, input.id);
      assertEditable(row.status);

      const task = await context.db.query.assignmentTask.findFirst({
        where: eq(assignmentTask.id, input.taskId),
      });
      if (!task || task.assignmentId !== assignment.id) {
        throw new ORPCError("NOT_FOUND", { message: "Assignment task not found" });
      }

      if (input.quizAttemptId) {
        // An attempt is a claim about who answered what: accepting somebody
        // else's run, or a run at a different quiz, would hand in their score.
        const attempt = await context.db.query.quizAttempt.findFirst({
          where: eq(quizAttempt.id, input.quizAttemptId),
        });
        if (!attempt || attempt.userId !== row.userId || attempt.quizId !== task.quizId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "That quiz attempt is not yours to hand in",
          });
        }
      }
      if (input.assetId) {
        const asset = await loadCourseAsset(context.db, input.assetId);
        if (asset.courseId !== course.id) {
          throw new ORPCError("BAD_REQUEST", {
            message: "That file belongs to a different course",
          });
        }
      }

      // Deliberately no activity row anywhere below: an autosaving draft would
      // otherwise write one audit entry per keystroke batch, and the hand-in
      // itself is the event the course cares about.
      return context.db.transaction(async (tx) => {
        const values = {
          content: input.content ?? null,
          contentText: input.contentText ?? "",
          assetId: input.assetId ?? null,
          quizAttemptId: input.quizAttemptId ?? null,
        };
        return firstRow(
          await tx
            .insert(submissionTask)
            .values({ submissionId: row.id, taskId: task.id, ...values })
            // One answer per task per attempt (the unique index says so), so a
            // re-save is an overwrite rather than a second row.
            .onConflictDoUpdate({
              target: [submissionTask.submissionId, submissionTask.taskId],
              set: { ...values, updatedAt: new Date() },
            })
            .returning(),
        );
      });
    }),

  submit: protectedProcedure
    .route({
      method: "POST",
      path: "/submissions/{id}/submit",
      tags: TAGS,
      summary: "Hand in an attempt",
    })
    .input(z.object({ id: IdSchema }))
    .output(SubmissionDetailSchema)
    .handler(async ({ input, context }) => {
      const { submission: row, assignment, course } = await requireOwnSubmission(context, input.id);
      assertEditable(row.status);

      if (assignment.maxAttempts !== null && row.attemptNumber > assignment.maxAttempts) {
        // The cap can be lowered after an attempt was opened; enforce it at the
        // moment it counts rather than trusting the row to still be allowed.
        throw new ORPCError("BAD_REQUEST", { message: "No attempts left for this assignment" });
      }

      const now = new Date();
      const isLate = assignment.dueAt !== null && now.getTime() > assignment.dueAt.getTime();
      if (isLate && !assignment.allowLateSubmission) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The deadline for this assignment has passed",
        });
      }

      const [tasks, answers] = await Promise.all([
        context.db.query.assignmentTask.findMany({
          where: eq(assignmentTask.assignmentId, assignment.id),
          orderBy: [asc(assignmentTask.position)],
        }),
        context.db.query.submissionTask.findMany({
          where: eq(submissionTask.submissionId, row.id),
        }),
      ]);
      // `every` is vacuously true on an empty brief, so the length check is what
      // keeps an assignment with no tasks from auto-awarding a pass.
      const autoGradable =
        assignment.gradingMethod === "auto" &&
        tasks.length > 0 &&
        tasks.every((task) => task.kind === "quiz");

      return context.db.transaction(async (tx) => {
        const handedIn = firstRow(
          await tx
            .update(submission)
            .set({ status: "submitted", submittedAt: now, isLate })
            .where(eq(submission.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "submission.submitted",
          ...activityActor(context),
          courseId: course.id,
          metadata: {
            submissionId: row.id,
            assignmentId: assignment.id,
            attemptNumber: row.attemptNumber,
            isLate,
          },
        });

        if (!autoGradable) return withTasks(tx, handedIn);

        // Every task is a quiz that already scored itself, so making the learner
        // wait for a human would only delay a result nobody is going to change.
        const attemptIds = answers
          .map((answer) => answer.quizAttemptId)
          .filter((id): id is string => id !== null);
        const attempts = attemptIds.length
          ? await tx.select().from(quizAttempt).where(inArray(quizAttempt.id, attemptIds))
          : [];
        const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));

        let score = 0;
        for (const task of tasks) {
          const answer = answers.find((candidate) => candidate.taskId === task.id);
          const attempt = answer?.quizAttemptId ? byId.get(answer.quizAttemptId) : undefined;
          // An unanswered task scores zero rather than skipping the total: the
          // grade is out of the whole brief, not out of what was attempted.
          const awarded =
            attempt && attempt.maxScore > 0
              ? Math.round((attempt.score / attempt.maxScore) * task.maxGrade)
              : 0;
          score += awarded;
          if (answer) {
            await tx
              .update(submissionTask)
              .set({ score: awarded })
              .where(eq(submissionTask.id, answer.id));
          }
        }
        const graded = await applyGrade(tx, {
          submission: row,
          assignment,
          tasks,
          score,
          gradedBy: null,
          gradedAt: now,
        });
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "submission.graded",
          ...activityActor(context),
          courseId: course.id,
          metadata: {
            submissionId: row.id,
            assignmentId: assignment.id,
            score: graded.score,
            maxScore: graded.maxScore,
            passed: graded.passed,
            automatic: true,
          },
        });
        return withTasks(tx, graded);
      });
    }),

  grade: protectedProcedure
    .route({
      method: "POST",
      path: "/submissions/{id}/grade",
      tags: TAGS,
      summary: "Record a grade for a hand-in",
    })
    .input(GradeSubmissionInputSchema)
    .output(SubmissionDetailSchema)
    .handler(async ({ input, context }) => {
      const { submission: row, assignment, course } = await requireGradable(context, input.id);
      if (row.status === "draft") {
        throw new ORPCError("BAD_REQUEST", { message: "This attempt has not been handed in yet" });
      }

      const tasks = await context.db.query.assignmentTask.findMany({
        where: eq(assignmentTask.assignmentId, assignment.id),
        orderBy: [asc(assignmentTask.position)],
      });
      const byTask = new Map(tasks.map((task) => [task.id, task]));
      for (const entry of input.tasks) {
        const task = byTask.get(entry.taskId);
        if (!task) {
          throw new ORPCError("BAD_REQUEST", {
            message: "That task belongs to a different assignment",
          });
        }
        if (entry.score > task.maxGrade) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Score for "${task.title}" exceeds its maximum of ${task.maxGrade}`,
          });
        }
      }

      const existing = await context.db.query.submissionTask.findMany({
        where: eq(submissionTask.submissionId, row.id),
      });

      return context.db.transaction(async (tx) => {
        for (const entry of input.tasks) {
          const values = { score: entry.score, feedback: entry.feedback ?? null };
          await tx
            .insert(submissionTask)
            // A grader may score a task the learner never answered, which is why
            // this inserts rather than only updates.
            .values({ submissionId: row.id, taskId: entry.taskId, ...values })
            .onConflictDoUpdate({
              target: [submissionTask.submissionId, submissionTask.taskId],
              set: { ...values, updatedAt: new Date() },
            });
        }

        // Tasks the grader left out keep the score they already carried, so a
        // partial regrade cannot silently zero the rest of the hand-in.
        const scored = new Map(input.tasks.map((entry) => [entry.taskId, entry.score]));
        const score = tasks.reduce((sum, task) => {
          const previous = existing.find((answer) => answer.taskId === task.id)?.score ?? 0;
          return sum + (scored.get(task.id) ?? previous);
        }, 0);

        const graded = await applyGrade(tx, {
          submission: row,
          assignment,
          tasks,
          score,
          feedback: input.feedback ?? null,
          feedbackText: input.feedbackText ?? "",
          gradedBy: context.session.user.id,
          gradedAt: new Date(),
        });
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "submission.graded",
          ...activityActor(context),
          courseId: course.id,
          metadata: {
            submissionId: row.id,
            assignmentId: assignment.id,
            learnerId: row.userId,
            score: graded.score,
            maxScore: graded.maxScore,
            passed: graded.passed,
          },
        });
        return withTasks(tx, graded);
      });
    }),

  returnToLearner: protectedProcedure
    .route({
      method: "POST",
      path: "/submissions/{id}/return",
      tags: TAGS,
      summary: "Send a hand-in back for another attempt",
    })
    .input(ReturnSubmissionInputSchema)
    .output(SubmissionDetailSchema)
    .handler(async ({ input, context }) => {
      const { submission: row, assignment, course } = await requireGradable(context, input.id);
      if (row.status === "draft" || row.status === "returned") {
        throw new ORPCError("BAD_REQUEST", { message: "This attempt is already with the learner" });
      }

      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(submission)
            // The score stays as it is: returning is a request for rework, not a
            // retraction of whatever was already marked.
            .set({
              status: "returned",
              feedback: input.feedback ?? null,
              feedbackText: input.feedbackText ?? "",
            })
            .where(eq(submission.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "submission.returned",
          ...activityActor(context),
          courseId: course.id,
          metadata: {
            submissionId: row.id,
            assignmentId: assignment.id,
            learnerId: row.userId,
            attemptNumber: row.attemptNumber,
          },
        });
        return withTasks(tx, updated);
      });
    }),
};

// ---------------------------------------------------------------------------

/** The db handle or a transaction — the helpers below run on either. */
type Executor = {
  select: Database["select"];
  insert: Database["insert"];
  update: Database["update"];
};

type SubmissionRow = typeof submission.$inferSelect;

/** Refuses the statuses a learner no longer owns. */
function assertEditable(status: string) {
  if (!EDITABLE.includes(status as (typeof EDITABLE)[number])) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This attempt has been handed in and can no longer be changed",
    });
  }
}

/**
 * The caller's own attempt, with the assignment and course it hangs off.
 *
 * NOT_FOUND rather than FORBIDDEN for somebody else's row: confirming that a
 * classmate's hand-in exists is already more than a learner should learn here.
 */
async function requireOwnSubmission(context: AuthedContext, id: string) {
  const row = await loadSubmission(context.db, id);
  if (row.userId !== context.session.user.id) {
    throw new ORPCError("NOT_FOUND", { message: "Submission not found" });
  }
  const assignment = await loadAssignment(context.db, row.assignmentId);
  const course = await loadCourse(context.db, assignment.courseId);
  return { submission: row, assignment, course };
}

/** A submission the caller is staff enough to mark. */
async function requireGradable(context: AuthedContext, id: string) {
  const row = await loadSubmission(context.db, id);
  const assignment = await loadAssignment(context.db, row.assignmentId);
  const course = await loadCourse(context.db, assignment.courseId);
  await requireCourseCapability(context.db, context, context.headers, course, "grade");
  return { submission: row, assignment, course };
}

/**
 * Writes one grading decision: the live values on the submission *and* an
 * append-only history row. The pair is the point — a regrade replaces what the
 * learner sees while leaving who decided what, and when, recoverable.
 */
async function applyGrade(
  tx: Executor,
  input: {
    submission: SubmissionRow;
    assignment: AssignmentRow;
    tasks: { maxGrade: number }[];
    score: number;
    feedback?: unknown;
    feedbackText?: string;
    gradedBy: string | null;
    gradedAt: Date;
  },
): Promise<SubmissionRow> {
  // The tasks in hand are the authority for the total, not `assignment.maxGrade`
  // — they are the same number by invariant, and this way a stale total can
  // never be baked into someone's result.
  const maxScore = input.tasks.reduce((sum, task) => sum + task.maxGrade, 0);
  const passed = input.score >= input.assignment.passingGrade;

  const [previous] = await tx
    .select({ version: max(submissionGrade.version) })
    .from(submissionGrade)
    .where(eq(submissionGrade.submissionId, input.submission.id));
  const feedbackText = input.feedbackText ?? input.submission.feedbackText;

  await tx.insert(submissionGrade).values({
    submissionId: input.submission.id,
    version: (previous?.version ?? 0) + 1,
    score: input.score,
    maxScore,
    passed,
    feedbackText,
    gradedBy: input.gradedBy,
  });

  return firstRow(
    await tx
      .update(submission)
      .set({
        status: "graded",
        score: input.score,
        maxScore,
        passed,
        ...(input.feedback !== undefined ? { feedback: input.feedback ?? null } : {}),
        feedbackText,
        gradedBy: input.gradedBy,
        gradedAt: input.gradedAt,
      })
      .where(eq(submission.id, input.submission.id))
      .returning(),
  );
}

/** A submission with the answers given to it, in task order. */
async function withTasks(tx: Executor, row: SubmissionRow) {
  const tasks = await tx
    .select()
    .from(submissionTask)
    .where(eq(submissionTask.submissionId, row.id))
    .orderBy(asc(submissionTask.createdAt));
  return { ...row, tasks };
}
