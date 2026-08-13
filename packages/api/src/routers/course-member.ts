import { ORPCError } from "@orpc/server";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { courseMember, team, user } from "@nilovon-wiki/db/schema/index";

import { protectedProcedure } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requireCourseCapability, requireCourseView } from "../lib/learn-authz";
import { loadCourse } from "../lib/learn-loaders";
import { assertPermissionSubjectInOrganization } from "../lib/permission-subject";
import {
  AddCourseMemberInputSchema,
  CourseMemberSchema,
  UpdateCourseMemberInputSchema,
} from "../schemas/course";
import { IdSchema } from "../schemas/shared";

/**
 * Course staff: who may author, grade and administer a course. The sibling of
 * `space-member.ts`, and deliberately shaped like it — a grant is for a user, a
 * team or an org group, and the same three-way subject rules apply.
 *
 * Learners are *not* here: enrolment is its own axis (see `enrollment`), which
 * is exactly why an LMS cannot reuse the wiki's single membership table.
 */

const TAGS = ["Course staff"];

// Both the db handle and a transaction satisfy this, so the joined read can run
// inside the transaction that inserted the row it describes.
type Executor = Pick<Database, "select">;

/** Joined select shared by list/load so both return the same shape. */
function selectMembers(db: Executor, where: SQL) {
  return db
    .select({
      id: courseMember.id,
      courseId: courseMember.courseId,
      subject: courseMember.subject,
      role: courseMember.role,
      roleName: courseMember.roleName,
      isPublic: courseMember.isPublic,
      createdAt: courseMember.createdAt,
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      team: { id: team.id, name: team.name },
    })
    .from(courseMember)
    .leftJoin(user, eq(courseMember.userId, user.id))
    .leftJoin(team, eq(courseMember.teamId, team.id))
    .where(where);
}

/** Reads a course-member row with its user/team display info, or throws. */
async function loadCourseMember(db: Executor, id: string) {
  const rows = await selectMembers(db, eq(courseMember.id, id));
  const row = rows[0];
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Course staff member not found" });
  return row;
}

type CourseMemberRow = Awaited<ReturnType<typeof loadCourseMember>>;

/**
 * Names the grantee in a form that outlives the row it describes.
 *
 * "A grant was removed" answers nothing; *whose* access changed is the question,
 * and the `course_member` row is gone by the time anybody reads the log. So the
 * subject is denormalized into the activity metadata, exactly as the space
 * membership router does it.
 */
function grantee(row: CourseMemberRow): Record<string, unknown> {
  return {
    subject: row.subject,
    subjectId: row.user?.id ?? row.team?.id ?? row.roleName ?? null,
    subjectName: row.user?.name ?? row.team?.name ?? row.roleName ?? null,
    // Two people share a display name more often than anyone expects, and an
    // access audit is precisely where "who exactly" has to be unambiguous.
    subjectEmail: row.user?.email ?? null,
  };
}

/**
 * Number of explicit `owner` grants on a course. Locks those rows (`FOR
 * UPDATE`), so it must run inside the transaction that performs the
 * demotion/removal: two concurrent calls would otherwise both count 2 owners
 * and each drop one, leaving the course with none.
 */
async function lockedOwnerCount(tx: Executor, courseId: string): Promise<number> {
  const rows = await tx
    .select({ id: courseMember.id })
    .from(courseMember)
    .where(and(eq(courseMember.courseId, courseId), eq(courseMember.role, "owner")))
    .for("update");
  return rows.length;
}

/**
 * Refuses to drop the last `owner` grant. `manage` — publishing, enrolments,
 * the staff list itself — is an owner-only capability, so a course without one
 * can no longer be administered by anybody who works inside it; it would take an
 * org owner/admin stepping in from outside to unstick it.
 */
async function assertNotLastOwner(tx: Executor, row: CourseMemberRow): Promise<void> {
  if (row.role !== "owner") return;
  if ((await lockedOwnerCount(tx, row.courseId)) <= 1) {
    throw new ORPCError("BAD_REQUEST", { message: "A course must keep at least one owner" });
  }
}

export const courseMemberRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/members",
      tags: TAGS,
      summary: "List a course's staff and their roles",
    })
    .input(z.object({ courseId: IdSchema }))
    .output(z.array(CourseMemberSchema))
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      // Seeing who teaches a course is part of its landing page, so this reads
      // at view level; changing the list is what needs `manage`.
      await requireCourseView(context.db, context, context.headers, courseRow);
      return selectMembers(context.db, eq(courseMember.courseId, courseRow.id)).orderBy(
        asc(courseMember.createdAt),
      );
    }),

  add: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{courseId}/members",
      tags: TAGS,
      summary: "Grant a user, team or group a staff role on a course",
    })
    .input(AddCourseMemberInputSchema)
    .output(CourseMemberSchema)
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "manage");
      await assertPermissionSubjectInOrganization(context.db, courseRow.organizationId, input);

      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(courseMember)
          .values({
            courseId: courseRow.id,
            subject: input.subject,
            userId: input.subject === "user" ? input.userId : null,
            teamId: input.subject === "team" ? input.teamId : null,
            roleName: input.subject === "role" ? input.roleName : null,
            role: input.role,
            isPublic: input.isPublic,
          })
          .onConflictDoNothing()
          .returning();
        const inserted = rows[0];
        if (!inserted) {
          throw new ORPCError("CONFLICT", { message: "Already staff on this course" });
        }
        const created = await loadCourseMember(tx, inserted.id);
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "course.member_added",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { title: courseRow.title, role: created.role, ...grantee(created) },
        });
        return created;
      });
    }),

  update: protectedProcedure
    .route({
      method: "PATCH",
      path: "/course-members/{id}",
      tags: TAGS,
      summary: "Change a staff member's role or listing on the landing page",
    })
    .input(UpdateCourseMemberInputSchema)
    .output(CourseMemberSchema)
    .handler(async ({ input, context }) => {
      const existing = await loadCourseMember(context.db, input.id);
      const courseRow = await loadCourse(context.db, existing.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "manage");

      // `role` is optional here: a request that only flips `isPublic` leaves the
      // grant untouched and must not trip the last-owner guard.
      const demoted = input.role !== undefined && input.role !== existing.role;

      await context.db.transaction(async (tx) => {
        if (demoted && input.role !== "owner") await assertNotLastOwner(tx, existing);
        await tx
          .update(courseMember)
          .set({
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
          })
          .where(eq(courseMember.id, input.id));
        // Only an actual role change is an access event. Toggling whether
        // someone is listed as an author changes a page, not a permission, and
        // filing it as `member_role_changed` would misreport it in the audit log.
        if (demoted) {
          await recordActivity(tx, {
            organizationId: courseRow.organizationId,
            action: "course.member_role_changed",
            ...activityActor(context),
            courseId: courseRow.id,
            metadata: {
              title: courseRow.title,
              from: existing.role,
              to: input.role,
              ...grantee(existing),
            },
          });
        }
      });
      return loadCourseMember(context.db, input.id);
    }),

  remove: protectedProcedure
    .route({
      method: "DELETE",
      path: "/course-members/{id}",
      tags: TAGS,
      summary: "Revoke a staff grant on a course",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const existing = await loadCourseMember(context.db, input.id);
      const courseRow = await loadCourse(context.db, existing.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "manage");

      await context.db.transaction(async (tx) => {
        await assertNotLastOwner(tx, existing);
        await tx.delete(courseMember).where(eq(courseMember.id, input.id));
        // Inside the transaction: a revocation that rolled back — because it
        // would have left the course ownerless — must not appear in the log.
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "course.member_removed",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { title: courseRow.title, role: existing.role, ...grantee(existing) },
        });
      });
      return { id: input.id };
    }),
};
