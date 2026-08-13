import { ORPCError } from "@orpc/server";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "@nilovon-wiki/db";
import {
  course,
  courseMember,
  enrollment,
  entitlement,
  product,
} from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { orgRoleNames, principalOf, userTeamIds, type Principal } from "./access";

/**
 * Course access control.
 *
 * Courses do not reuse the space rules, because an LMS adds an axis the wiki
 * does not have: **enrolment**. A learner is typically a plain org member with
 * no authoring permission anywhere, and yet must be able to open every lesson
 * of the one course they signed up for — while a colleague with full `page:*`
 * rights must not be able to read that same course unless they enrol or are
 * staff on it.
 *
 * So access is resolved from four independent facts:
 *
 *   1. the course's `visibility` (private / organization / public)
 *   2. the caller's **enrolment** in it
 *   3. the caller's **staff grant** on it (`course_member`, incl. teams/groups)
 *   4. the caller's **org role** (owner/admin administer their org's courses)
 *
 * plus `status`, which gates everything: a draft is invisible to non-staff and
 * an archived course stays readable for the people already in it.
 *
 * This module is intentionally free of env, auth and network imports so the
 * decision tables below can be unit-tested without a database — the same
 * discipline `access.ts` follows.
 */

export type CourseStatus = "draft" | "published" | "archived";
export type CourseVisibility = "private" | "organization" | "public";
export type CourseRole = "reviewer" | "assistant" | "instructor" | "owner";
export type EnrollmentStatus = "pending" | "active" | "completed" | "dropped";
export type EnrollmentPolicy = "open" | "request" | "invite" | "paid";

// ---------------------------------------------------------------------------
// Staff roles
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<CourseRole, number> = {
  reviewer: 1,
  assistant: 2,
  instructor: 3,
  owner: 4,
};

/**
 * What a staff member may do. Ranked, so a grant implies every weaker one.
 *
 *   view   — read the course including unpublished content
 *   grade  — mark submissions and see every learner's work
 *   author — create and edit chapters, lessons, assignments, quizzes
 *   manage — publish, delete, change staff, manage enrolments
 */
export type CourseCapability = "view" | "grade" | "author" | "manage";

const CAPABILITY_RANK: Record<CourseCapability, number> = {
  view: ROLE_RANK.reviewer,
  grade: ROLE_RANK.assistant,
  author: ROLE_RANK.instructor,
  manage: ROLE_RANK.owner,
};

/** True if `role` (or none) is sufficient for `capability`. */
export function roleAllows(role: CourseRole | null, capability: CourseCapability): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= CAPABILITY_RANK[capability];
}

/** The stronger of two staff roles (null = no grant). */
export function maxRole(a: CourseRole | null, b: CourseRole | null): CourseRole | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type CourseAccessFacts = {
  status: CourseStatus;
  visibility: CourseVisibility;
  /** Highest `course_member` role held directly, via a team, or via a group. */
  memberRole: CourseRole | null;
  isCreator: boolean;
  /** Org owner/admin — they administer every course in their organization. */
  isOrgManager: boolean;
  /** Whether the caller is a member of the course's organization at all. */
  isOrgMember: boolean;
  /** The caller's enrolment, or null if they have never enrolled. */
  enrollment: EnrollmentStatus | null;
};

export type CourseAccess = {
  /**
   * The catalog card and the landing page: title, description, outline,
   * price — everything needed to decide whether to enrol. Never the content.
   */
  canView: boolean;
  /** Open lessons and record progress. */
  canLearn: boolean;
  /** The caller's effective staff role, or null if they are not staff. */
  role: CourseRole | null;
};

/**
 * The core decision, kept pure so its truth table is unit-testable.
 *
 * The two answers are deliberately separate: "may see that it exists" and "may
 * consume it" are different questions for every LMS, and collapsing them is
 * what produces either an invisible catalog or a paywall that leaks content.
 */
export function resolveCourseAccess(facts: CourseAccessFacts): CourseAccess {
  // Creators and org managers act as course owners — but note this is the only
  // place an org-level right enters. It cannot be widened by handing someone
  // `page:update`; nothing below reads the wiki permission surface.
  const role: CourseRole | null =
    facts.isCreator || facts.isOrgManager ? "owner" : facts.memberRole;

  // Staff see their own course in every state, including drafts.
  if (role !== null) {
    return { canView: true, canLearn: true, role };
  }

  const enrolled = facts.enrollment === "active" || facts.enrollment === "completed";

  // A draft has no audience but its staff. Not even an existing enrolment
  // reopens it — unpublishing is how an author takes a course off the air.
  if (facts.status === "draft") {
    return { canView: false, canLearn: false, role: null };
  }

  const canView = (() => {
    switch (facts.visibility) {
      case "public":
        // Readable without a session; this is what makes a public catalog and
        // shareable landing pages possible.
        return true;
      case "organization":
        return facts.isOrgMember;
      case "private":
        // Invisible unless the caller has an enrolment. A dropped learner keeps
        // the landing page so they can rejoin; that is the point of not
        // deleting the row.
        return facts.enrollment !== null;
    }
  })();

  if (!canView) {
    return { canView: false, canLearn: false, role: null };
  }

  // An archived course is frozen, not withdrawn: the people who were taking it
  // keep their access, nobody new gets in.
  const canLearn = enrolled;
  return { canView: true, canLearn, role: null };
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export type EnrollabilityFacts = {
  access: CourseAccess;
  status: CourseStatus;
  policy: EnrollmentPolicy;
  enrollment: EnrollmentStatus | null;
  /** Remaining seats, or null when the course is uncapped. */
  seatsLeft: number | null;
  /** `course.enrollmentClosesAt`, already compared against "now" by the caller. */
  closed: boolean;
  /** Whether the caller holds a live entitlement for the course's product. */
  hasEntitlement: boolean;
};

export type EnrollabilityReason =
  | "ok"
  | "approval_required"
  | "already_enrolled"
  | "not_visible"
  | "not_published"
  | "closed"
  | "full"
  | "invite_only"
  | "payment_required";

export type Enrollability = {
  allowed: boolean;
  /**
   * Why, whether or not it is allowed — `approval_required` is an *allowed*
   * outcome that produces a `pending` row rather than an active one. The UI
   * renders this verbatim, so every refusal is explainable to the learner.
   */
  reason: EnrollabilityReason;
};

/** Whether the caller may enrol themselves right now. Pure. */
export function resolveEnrollability(facts: EnrollabilityFacts): Enrollability {
  if (facts.enrollment === "active" || facts.enrollment === "completed") {
    return { allowed: false, reason: "already_enrolled" };
  }
  if (facts.enrollment === "pending") {
    return { allowed: false, reason: "approval_required" };
  }
  if (!facts.access.canView) {
    return { allowed: false, reason: "not_visible" };
  }
  // Archived courses are readable for their existing learners but closed to
  // new ones; drafts are not published at all.
  if (facts.status !== "published") {
    return { allowed: false, reason: "not_published" };
  }
  if (facts.closed) {
    return { allowed: false, reason: "closed" };
  }
  if (facts.seatsLeft !== null && facts.seatsLeft <= 0) {
    return { allowed: false, reason: "full" };
  }
  switch (facts.policy) {
    case "invite":
      return { allowed: false, reason: "invite_only" };
    case "paid":
      return facts.hasEntitlement
        ? { allowed: true, reason: "ok" }
        : { allowed: false, reason: "payment_required" };
    case "request":
      return { allowed: true, reason: "approval_required" };
    case "open":
      return { allowed: true, reason: "ok" };
  }
}

// ---------------------------------------------------------------------------
// Loading the facts
// ---------------------------------------------------------------------------

/** The columns every access decision needs. Keep queries selecting exactly these. */
export type CourseAccessInput = {
  id: string;
  organizationId: string;
  status: CourseStatus;
  visibility: CourseVisibility;
  createdBy: string | null;
};

/** Highest staff role the user holds on a course — directly, via a team, or a group. */
async function memberRoleOnCourse(
  db: Database,
  courseId: string,
  userId: string,
  teamIds: string[],
  roleNames: string[],
): Promise<CourseRole | null> {
  const rows = await db.query.courseMember.findMany({
    where: and(
      eq(courseMember.courseId, courseId),
      or(
        eq(courseMember.userId, userId),
        teamIds.length ? inArray(courseMember.teamId, teamIds) : undefined,
        roleNames.length ? inArray(courseMember.roleName, roleNames) : undefined,
      ),
    ),
    columns: { role: true },
  });
  return rows.reduce<CourseRole | null>((acc, row) => maxRole(acc, row.role as CourseRole), null);
}

async function enrollmentStatusOf(
  db: Database,
  courseId: string,
  userId: string,
): Promise<EnrollmentStatus | null> {
  const row = await db.query.enrollment.findFirst({
    where: and(eq(enrollment.courseId, courseId), eq(enrollment.userId, userId)),
    columns: { status: true },
  });
  return (row?.status as EnrollmentStatus | undefined) ?? null;
}

/**
 * Whether the user holds a live entitlement for a course's product — not
 * revoked, already started, not expired. This is the only question access
 * control asks about money; how the entitlement was obtained is irrelevant here.
 */
export async function hasCourseEntitlement(
  db: Database,
  userId: string,
  courseId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .select({ id: entitlement.id })
    .from(entitlement)
    .innerJoin(product, eq(entitlement.productId, product.id))
    .where(
      and(
        eq(product.courseId, courseId),
        eq(entitlement.userId, userId),
        isNull(entitlement.revokedAt),
        or(isNull(entitlement.endsAt), gt(entitlement.endsAt, now)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Loads every fact `resolveCourseAccess` needs, then decides. */
export async function loadCourseAccessAs(
  db: Database,
  principal: Principal,
  target: CourseAccessInput,
  isOrgManager: boolean,
): Promise<CourseAccess> {
  const isOrgMember = target.organizationId === principal.organizationId;
  const { userId } = principal;
  // Rights never cross an organization boundary: an org manager elsewhere is a
  // stranger here, so the manager override only applies inside the course's org.
  const managerHere = isOrgMember && isOrgManager;

  const [teamIds, roleNames, enrollmentStatus] = await Promise.all([
    userTeamIds(db, userId),
    isOrgMember ? orgRoleNames(db, userId, target.organizationId) : Promise.resolve([]),
    enrollmentStatusOf(db, target.id, userId),
  ]);
  const memberRole = await memberRoleOnCourse(db, target.id, userId, teamIds, roleNames);

  return resolveCourseAccess({
    status: target.status,
    visibility: target.visibility,
    memberRole,
    isCreator: target.createdBy === userId,
    isOrgManager: managerHere,
    isOrgMember,
    enrollment: enrollmentStatus,
  });
}

/** Session-bound wrapper around `loadCourseAccessAs`. */
export async function loadCourseAccess(
  db: Database,
  context: AuthedContext,
  target: CourseAccessInput,
  isOrgManager: boolean,
): Promise<CourseAccess> {
  return loadCourseAccessAs(db, principalOf(context), target, isOrgManager);
}

/**
 * Access for a caller with no session at all. Only `public` + `published`
 * courses can pass, which is exactly the anonymous catalog.
 */
export function resolveAnonymousCourseAccess(target: CourseAccessInput): CourseAccess {
  return resolveCourseAccess({
    status: target.status,
    visibility: target.visibility,
    memberRole: null,
    isCreator: false,
    isOrgManager: false,
    isOrgMember: false,
    enrollment: null,
  });
}

// ---------------------------------------------------------------------------
// Throwing gates used at the top of handlers
// ---------------------------------------------------------------------------

/** Throws NOT_FOUND unless the caller may at least see that the course exists. */
export async function assertCourseView(
  db: Database,
  context: AuthedContext,
  target: CourseAccessInput,
  isOrgManager: boolean,
): Promise<CourseAccess> {
  const access = await loadCourseAccess(db, context, target, isOrgManager);
  // NOT_FOUND rather than FORBIDDEN: for a private course, confirming that the
  // id exists is itself a leak.
  if (!access.canView) throw new ORPCError("NOT_FOUND");
  return access;
}

/** Throws unless the caller may open the course's content. */
export async function assertCourseLearn(
  db: Database,
  context: AuthedContext,
  target: CourseAccessInput,
  isOrgManager: boolean,
): Promise<CourseAccess> {
  const access = await loadCourseAccess(db, context, target, isOrgManager);
  if (!access.canView) throw new ORPCError("NOT_FOUND");
  if (!access.canLearn) throw new ORPCError("FORBIDDEN", { message: "Enrol to open this course" });
  return access;
}

/** Throws unless the caller holds `capability` as staff on the course. */
export async function assertCourseCapability(
  db: Database,
  context: AuthedContext,
  target: CourseAccessInput,
  capability: CourseCapability,
  isOrgManager: boolean,
): Promise<CourseAccess> {
  const access = await loadCourseAccess(db, context, target, isOrgManager);
  if (!access.canView) throw new ORPCError("NOT_FOUND");
  if (!roleAllows(access.role, capability)) throw new ORPCError("FORBIDDEN");
  return access;
}

// ---------------------------------------------------------------------------
// Batch filtering — the catalog, search, dashboards
// ---------------------------------------------------------------------------

/**
 * Builds a synchronous `canView` predicate after loading the principal's staff
 * grants and enrolments **once**, so a catalog page filters N courses without N
 * queries. The analogue of `buildSpaceReadFilter`.
 */
export async function buildCourseViewFilterAs(
  db: Database,
  principal: Principal,
  isOrgManager: boolean,
): Promise<(target: CourseAccessInput) => boolean> {
  const { userId, organizationId } = principal;
  const [teamIds, roleNames] = await Promise.all([
    userTeamIds(db, userId),
    organizationId ? orgRoleNames(db, userId, organizationId) : Promise.resolve<string[]>([]),
  ]);
  const [staffRows, enrolledRows] = await Promise.all([
    db
      .select({ courseId: courseMember.courseId, role: courseMember.role })
      .from(courseMember)
      .where(
        or(
          eq(courseMember.userId, userId),
          teamIds.length ? inArray(courseMember.teamId, teamIds) : undefined,
          roleNames.length ? inArray(courseMember.roleName, roleNames) : undefined,
        ),
      ),
    db
      .select({ courseId: enrollment.courseId, status: enrollment.status })
      .from(enrollment)
      .where(eq(enrollment.userId, userId)),
  ]);

  const roleByCourse = new Map<string, CourseRole>();
  for (const row of staffRows) {
    const next = maxRole(roleByCourse.get(row.courseId) ?? null, row.role as CourseRole);
    if (next) roleByCourse.set(row.courseId, next);
  }
  const statusByCourse = new Map<string, EnrollmentStatus>(
    enrolledRows.map((row) => [row.courseId, row.status as EnrollmentStatus]),
  );

  return (target) => {
    const isOrgMember = target.organizationId === organizationId;
    return resolveCourseAccess({
      status: target.status,
      visibility: target.visibility,
      memberRole: roleByCourse.get(target.id) ?? null,
      isCreator: target.createdBy === userId,
      isOrgManager: isOrgMember && isOrgManager,
      isOrgMember,
      enrollment: statusByCourse.get(target.id) ?? null,
    }).canView;
  };
}

/** Session-bound wrapper around `buildCourseViewFilterAs`. */
export async function buildCourseViewFilter(
  db: Database,
  context: AuthedContext,
  isOrgManager: boolean,
): Promise<(target: CourseAccessInput) => boolean> {
  return buildCourseViewFilterAs(db, principalOf(context), isOrgManager);
}

/**
 * The ids of every course in `organizationId` the principal may see. Used to
 * scope cross-course reads (search, dashboards, analytics) the same way
 * `readableSpaceIds` scopes the wiki.
 */
export async function viewableCourseIdsAs(
  db: Database,
  principal: Principal,
  organizationId: string,
  isOrgManager: boolean,
): Promise<string[]> {
  const [rows, canView] = await Promise.all([
    db
      .select({
        id: course.id,
        organizationId: course.organizationId,
        status: course.status,
        visibility: course.visibility,
        createdBy: course.createdBy,
      })
      .from(course)
      .where(and(eq(course.organizationId, organizationId), isNull(course.deletedAt))),
    buildCourseViewFilterAs(db, principal, isOrgManager),
  ]);
  return (rows as CourseAccessInput[]).filter(canView).map((row) => row.id);
}

/** Session-bound wrapper around `viewableCourseIdsAs`. */
export async function viewableCourseIds(
  db: Database,
  context: AuthedContext,
  organizationId: string,
  isOrgManager: boolean,
): Promise<string[]> {
  return viewableCourseIdsAs(db, principalOf(context), organizationId, isOrgManager);
}
