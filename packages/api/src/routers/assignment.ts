import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { assignment, assignmentTask, submission } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import type { CourseAccess, CourseCapability } from "../lib/course-access";
import { generateKeyBetween } from "../lib/fractional";
import {
  requireCourseCapability,
  requireLessonCapability,
  requireLessonRead,
} from "../lib/learn-authz";
import { loadAssignment, loadCourse, loadQuiz } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import {
  AddAssignmentTaskInputSchema,
  AssignmentDetailSchema,
  AssignmentSchema,
  AssignmentWithTasksSchema,
  CreateAssignmentInputSchema,
  MoveAssignmentTaskInputSchema,
  UpdateAssignmentInputSchema,
  UpdateAssignmentTaskInputSchema,
} from "../schemas/assignment";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Assignments"];

export const assignmentRouter = {
  get: protectedProcedure
    .route({
      method: "GET",
      path: "/assignments/{id}",
      tags: TAGS,
      summary: "Get an assignment with its tasks and the caller's own attempt",
    })
    .input(z.object({ id: IdSchema }))
    .output(AssignmentDetailSchema)
    .handler(async ({ input, context }) => {
      const row = await loadAssignment(context.db, input.id);
      // The lesson is the unit access is granted on, so the brief inherits its
      // rules wholesale: staff read it in any state, learners need an enrolment
      // and a published lesson.
      const { access } = await requireLessonRead(
        context.db,
        context,
        context.headers,
        row.lessonId,
      );
      return buildAssignmentDetail(context, row, access);
    }),

  getForLesson: protectedProcedure
    .route({
      method: "GET",
      path: "/lessons/{lessonId}/assignment",
      tags: TAGS,
      summary: "Get the assignment attached to a lesson",
    })
    .input(z.object({ lessonId: IdSchema }))
    .output(AssignmentDetailSchema)
    .handler(async ({ input, context }) => {
      const { access } = await requireLessonRead(
        context.db,
        context,
        context.headers,
        input.lessonId,
      );
      const row = await context.db.query.assignment.findFirst({
        where: eq(assignment.lessonId, input.lessonId),
      });
      if (!row) throw new ORPCError("NOT_FOUND", { message: "Assignment not found" });
      return buildAssignmentDetail(context, row, access);
    }),

  create: protectedProcedure
    .route({
      method: "POST",
      path: "/assignments",
      tags: TAGS,
      summary: "Create the assignment for an assignment lesson",
    })
    .input(CreateAssignmentInputSchema)
    .output(AssignmentSchema)
    .handler(async ({ input, context }) => {
      const { lesson, course } = await requireLessonCapability(
        context.db,
        context,
        context.headers,
        input.lessonId,
        "author",
      );
      if (lesson.kind !== "assignment") {
        // The lesson kind decides which player the learner gets; attaching a
        // hand-in to a video would produce a lesson nobody can submit from.
        throw new ORPCError("BAD_REQUEST", {
          message: "Only a lesson of kind 'assignment' can carry an assignment",
        });
      }

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const row = firstRow(
              await tx
                .insert(assignment)
                .values({
                  courseId: lesson.courseId,
                  lessonId: lesson.id,
                  title: input.title,
                  instructions: input.instructions ?? null,
                  instructionsText: input.instructionsText ?? "",
                  dueAt: input.dueAt ?? null,
                  // The total is derived from the tasks and recomputed on every
                  // task write; with no tasks yet it is genuinely zero.
                  maxGrade: 0,
                  ...(input.passingGrade !== undefined ? { passingGrade: input.passingGrade } : {}),
                  gradingMethod: input.gradingMethod,
                  allowLateSubmission: input.allowLateSubmission,
                  maxAttempts: input.maxAttempts ?? null,
                  blindGrading: input.blindGrading,
                })
                .returning(),
            );
            await recordActivity(tx, {
              organizationId: course.organizationId,
              action: "assignment.created",
              ...activityActor(context),
              courseId: course.id,
              metadata: { assignmentId: row.id, lessonId: row.lessonId, title: row.title },
            });
            return row;
          }),
        // The unique index on `lesson_id` is what enforces the one-to-one, so a
        // racing second create loses here rather than at a pre-check.
        "This lesson already has an assignment",
      );
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/assignments/{id}",
      tags: TAGS,
      summary: "Update an assignment brief",
    })
    .input(UpdateAssignmentInputSchema)
    .output(AssignmentSchema)
    .handler(async ({ input, context }) => {
      const { assignment: row, course } = await requireAssignment(context, input.id, "author");
      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(assignment)
            .set({
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.instructions !== undefined
                ? { instructions: input.instructions ?? null }
                : {}),
              ...(input.instructionsText !== undefined
                ? { instructionsText: input.instructionsText }
                : {}),
              ...(input.dueAt !== undefined ? { dueAt: input.dueAt ?? null } : {}),
              ...(input.passingGrade !== undefined ? { passingGrade: input.passingGrade } : {}),
              ...(input.gradingMethod !== undefined ? { gradingMethod: input.gradingMethod } : {}),
              ...(input.allowLateSubmission !== undefined
                ? { allowLateSubmission: input.allowLateSubmission }
                : {}),
              ...(input.maxAttempts !== undefined
                ? { maxAttempts: input.maxAttempts ?? null }
                : {}),
              ...(input.blindGrading !== undefined ? { blindGrading: input.blindGrading } : {}),
            })
            .where(eq(assignment.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { assignmentId: updated.id, title: updated.title },
        });
        return updated;
      });
    }),

  publish: protectedProcedure
    .route({
      method: "POST",
      path: "/assignments/{id}/publish",
      tags: TAGS,
      summary: "Publish an assignment so enrolled learners can hand in",
    })
    .input(z.object({ id: IdSchema }))
    .output(AssignmentSchema)
    .handler(async ({ input, context }) => {
      const { assignment: row, course } = await requireAssignment(context, input.id, "author");

      // Publishing a brief with no tasks would open a hand-in nobody can hand
      // anything in to, and would fix its total grade at zero.
      const tasks = await context.db.query.assignmentTask.findMany({
        where: eq(assignmentTask.assignmentId, row.id),
        columns: { id: true },
      });
      if (tasks.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Add at least one task before publishing this assignment",
        });
      }

      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(assignment)
            // Keep the original date on a republish: learners' deadlines and
            // late flags are read against when the brief first went live.
            .set({ publishedAt: row.publishedAt ?? new Date() })
            .where(eq(assignment.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { assignmentId: updated.id, title: updated.title, published: true },
        });
        return updated;
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/assignments/{id}",
      tags: TAGS,
      summary: "Delete an assignment and everything handed in against it",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const { assignment: row, course } = await requireAssignment(context, input.id, "author");
      return context.db.transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.deleted",
          ...activityActor(context),
          courseId: course.id,
          // Denormalized: the row is gone and the audit entry has to still say
          // what was deleted.
          metadata: { assignmentId: row.id, lessonId: row.lessonId, title: row.title },
        });
        // Cascades take the tasks, the submissions and their grade history with
        // it — an assignment nobody can see must not leave gradable orphans.
        await tx.delete(assignment).where(eq(assignment.id, row.id));
        return { id: row.id };
      });
    }),

  addTask: protectedProcedure
    .route({
      method: "POST",
      path: "/assignments/{id}/tasks",
      tags: TAGS,
      summary: "Append a task to an assignment",
    })
    .input(AddAssignmentTaskInputSchema)
    .output(AssignmentWithTasksSchema)
    .handler(async ({ input, context }) => {
      const { assignment: row, course } = await requireAssignment(context, input.id, "author");
      await assertQuizTask(context.db, {
        kind: input.kind,
        quizId: input.quizId ?? null,
        courseId: row.courseId,
      });

      const last = await context.db.query.assignmentTask.findFirst({
        where: eq(assignmentTask.assignmentId, row.id),
        orderBy: [desc(assignmentTask.position)],
        columns: { position: true },
      });

      return context.db.transaction(async (tx) => {
        const task = firstRow(
          await tx
            .insert(assignmentTask)
            .values({
              assignmentId: row.id,
              kind: input.kind,
              title: input.title,
              description: input.description ?? null,
              position: generateKeyBetween(last?.position ?? null, null),
              maxGrade: input.maxGrade,
              quizId: input.quizId ?? null,
              config: input.config ?? null,
            })
            .returning(),
        );
        const result = await resyncMaxGrade(tx, row.id);
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { assignmentId: row.id, taskId: task.id, title: task.title },
        });
        return result;
      });
    }),

  updateTask: protectedProcedure
    .route({
      method: "PATCH",
      path: "/assignment-tasks/{id}",
      tags: TAGS,
      summary: "Update one task of an assignment",
    })
    .input(UpdateAssignmentTaskInputSchema)
    .output(AssignmentWithTasksSchema)
    .handler(async ({ input, context }) => {
      const { task, assignment: row, course } = await requireTask(context, input.id, "author");
      if (input.quizId !== undefined) {
        await assertQuizTask(context.db, {
          kind: task.kind,
          quizId: input.quizId ?? null,
          courseId: row.courseId,
        });
      }

      return context.db.transaction(async (tx) => {
        await tx
          .update(assignmentTask)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description ?? null } : {}),
            ...(input.maxGrade !== undefined ? { maxGrade: input.maxGrade } : {}),
            ...(input.quizId !== undefined ? { quizId: input.quizId ?? null } : {}),
            ...(input.config !== undefined ? { config: input.config ?? null } : {}),
          })
          .where(eq(assignmentTask.id, task.id));
        const result = await resyncMaxGrade(tx, row.id);
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { assignmentId: row.id, taskId: task.id },
        });
        return result;
      });
    }),

  moveTask: protectedProcedure
    .route({
      method: "POST",
      path: "/assignment-tasks/{id}/move",
      tags: TAGS,
      summary: "Reorder a task within its assignment",
    })
    .input(MoveAssignmentTaskInputSchema)
    .output(AssignmentWithTasksSchema)
    .handler(async ({ input, context }) => {
      const { task, assignment: row, course } = await requireTask(context, input.id, "author");

      const siblings = (
        await context.db.query.assignmentTask.findMany({
          where: eq(assignmentTask.assignmentId, row.id),
          orderBy: [asc(assignmentTask.position)],
          columns: { id: true, position: true },
        })
      )
        // The moving row is not its own neighbour: leaving it in would make the
        // key generator bracket the task against itself.
        .filter((sibling) => sibling.id !== task.id);

      const after = input.afterTaskId ?? null;
      const index = after ? siblings.findIndex((sibling) => sibling.id === after) : -1;
      if (after && index === -1) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The task to move after belongs to a different assignment",
        });
      }
      const previous = index >= 0 ? (siblings[index]?.position ?? null) : null;
      const next = siblings[index + 1]?.position ?? null;

      return context.db.transaction(async (tx) => {
        await tx
          .update(assignmentTask)
          // Fractional keys mean a reorder writes exactly the moved row, so two
          // authors reordering different tasks never collide.
          .set({ position: generateKeyBetween(previous, next) })
          .where(eq(assignmentTask.id, task.id));
        const result = await resyncMaxGrade(tx, row.id);
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { assignmentId: row.id, taskId: task.id, moved: true },
        });
        return result;
      });
    }),

  deleteTask: protectedProcedure
    .route({
      method: "DELETE",
      path: "/assignment-tasks/{id}",
      tags: TAGS,
      summary: "Delete a task and the answers given to it",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const { task, assignment: row, course } = await requireTask(context, input.id, "author");
      return context.db.transaction(async (tx) => {
        await tx.delete(assignmentTask).where(eq(assignmentTask.id, task.id));
        await resyncMaxGrade(tx, row.id);
        await recordActivity(tx, {
          organizationId: course.organizationId,
          action: "assignment.updated",
          ...activityActor(context),
          courseId: course.id,
          metadata: { assignmentId: row.id, taskId: task.id, title: task.title, deleted: true },
        });
        return { id: task.id };
      });
    }),
};

// ---------------------------------------------------------------------------

/** The db handle or a transaction — both write the derived total the same way. */
type Executor = {
  select: Database["select"];
  update: Database["update"];
};

/**
 * Rewrites `assignment.maxGrade` from the tasks that exist right now and returns
 * the pair. The total is derived rather than entered because a grade out of a
 * number that no longer matches the tasks is unexplainable to the learner who
 * receives it.
 */
async function resyncMaxGrade(tx: Executor, assignmentId: string) {
  const tasks = await tx
    .select()
    .from(assignmentTask)
    .where(eq(assignmentTask.assignmentId, assignmentId))
    .orderBy(asc(assignmentTask.position));
  const total = tasks.reduce((sum, task) => sum + task.maxGrade, 0);
  const row = firstRow(
    await tx
      .update(assignment)
      .set({ maxGrade: total })
      .where(eq(assignment.id, assignmentId))
      .returning(),
  );
  return { ...row, tasks };
}

/** Resolve an assignment and assert a staff capability on its course. */
async function requireAssignment(context: AuthedContext, id: string, capability: CourseCapability) {
  const row = await loadAssignment(context.db, id);
  const course = await loadCourse(context.db, row.courseId);
  await requireCourseCapability(context.db, context, context.headers, course, capability);
  return { assignment: row, course };
}

/** Resolve a task, its assignment and course, then assert a capability. */
async function requireTask(context: AuthedContext, id: string, capability: CourseCapability) {
  const task = await context.db.query.assignmentTask.findFirst({
    where: eq(assignmentTask.id, id),
  });
  if (!task) throw new ORPCError("NOT_FOUND", { message: "Assignment task not found" });
  const resolved = await requireAssignment(context, task.assignmentId, capability);
  return { task, assignment: resolved.assignment, course: resolved.course };
}

/**
 * A quiz task without a quiz is unanswerable, and a quiz from another course
 * would expose questions to learners who never enrolled there — the FK alone
 * checks neither.
 */
async function assertQuizTask(
  db: Database,
  input: { kind: string; quizId: string | null; courseId: string },
) {
  if (input.kind !== "quiz") return;
  if (!input.quizId) {
    throw new ORPCError("BAD_REQUEST", { message: "A quiz task needs a quizId" });
  }
  const quiz = await loadQuiz(db, input.quizId);
  if (quiz.courseId !== input.courseId) {
    throw new ORPCError("BAD_REQUEST", { message: "That quiz belongs to a different course" });
  }
}

/** The brief, its tasks and whatever the caller last handed in against it. */
async function buildAssignmentDetail(
  context: AuthedContext,
  row: Awaited<ReturnType<typeof loadAssignment>>,
  access: CourseAccess,
) {
  if (!access.role && !row.publishedAt) {
    // An unpublished brief is invisible to learners even on a published lesson:
    // its tasks and grading rules are still being written.
    throw new ORPCError("NOT_FOUND", { message: "Assignment not found" });
  }
  const userId = context.session.user.id;
  const [tasks, mine] = await Promise.all([
    context.db.query.assignmentTask.findMany({
      where: eq(assignmentTask.assignmentId, row.id),
      orderBy: [asc(assignmentTask.position)],
    }),
    context.db.query.submission.findFirst({
      where: and(eq(submission.assignmentId, row.id), eq(submission.userId, userId)),
      orderBy: [desc(submission.attemptNumber)],
    }),
  ]);
  return { ...row, tasks, mySubmission: mine ?? null };
}
