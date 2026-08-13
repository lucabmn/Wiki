import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  course,
  courseMember,
  courseTopicLink,
  enrollment,
  lesson,
  product,
  productPrice,
} from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import {
  hasCourseEntitlement,
  resolveEnrollability,
  type CourseAccessInput,
} from "../lib/course-access";
import {
  courseListWhere,
  loadCourseCardFacts,
  seatsLeft,
  toCourse,
  toCourseCard,
} from "../lib/course-cards";
import { courseViewFilter, requireCourseCapability, resolveAccess } from "../lib/learn-authz";
import { findEnrollment, loadCourse, loadCourseBySlug } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CourseCardSchema,
  CourseDetailSchema,
  CourseSchema,
  CreateCourseInputSchema,
  ListCoursesInputSchema,
  UpdateCourseInputSchema,
} from "../schemas/course";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Courses"];

/** Columns the access resolver needs — select exactly these when filtering. */
function accessInput(row: {
  id: string;
  organizationId: string;
  status: string;
  visibility: string;
  createdBy: string | null;
}): CourseAccessInput {
  return row as CourseAccessInput;
}

export const courseRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/courses",
      tags: TAGS,
      summary: "List courses in the active organization (the catalog)",
    })
    .input(ListCoursesInputSchema)
    .output(z.array(CourseCardSchema))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;

      // Narrow in SQL what can be narrowed in SQL; the access rules are resolved
      // afterwards against the caller's memberships, loaded once.
      const scopedIds = input.topicId
        ? (
            await context.db
              .select({ courseId: courseTopicLink.courseId })
              .from(courseTopicLink)
              .where(eq(courseTopicLink.topicId, input.topicId))
          ).map((row) => row.courseId)
        : null;
      if (scopedIds !== null && scopedIds.length === 0) return [];

      const enrolledIds = input.enrolledOnly
        ? (
            await context.db
              .select({ courseId: enrollment.courseId })
              .from(enrollment)
              .where(
                and(
                  eq(enrollment.userId, userId),
                  inArray(enrollment.status, ["pending", "active", "completed"]),
                ),
              )
          ).map((row) => row.courseId)
        : null;
      if (enrolledIds !== null && enrolledIds.length === 0) return [];

      const authoredIds = input.authoredOnly
        ? (
            await context.db
              .select({ courseId: courseMember.courseId })
              .from(courseMember)
              .where(eq(courseMember.userId, userId))
          ).map((row) => row.courseId)
        : null;

      const [rows, canView] = await Promise.all([
        context.db.query.course.findMany({
          where: and(
            courseListWhere(organizationId, input.query),
            input.status ? eq(course.status, input.status) : undefined,
            input.level ? eq(course.level, input.level) : undefined,
            input.includeArchived ? undefined : isNull(course.archivedAt),
            scopedIds ? inArray(course.id, scopedIds) : undefined,
            enrolledIds ? inArray(course.id, enrolledIds) : undefined,
            // `authoredOnly` with no staff rows still has to admit courses the
            // caller created, so it is resolved after the access filter below
            // rather than as an empty `inArray` here.
            authoredIds && authoredIds.length
              ? inArray(course.id, authoredIds)
              : authoredIds
                ? eq(course.createdBy, userId)
                : undefined,
          ),
          orderBy: [desc(course.publishedAt), desc(course.createdAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        courseViewFilter(context.db, context, context.headers, organizationId),
      ]);

      const visible = rows.filter((row) => canView(accessInput(row)));
      const facts = await loadCourseCardFacts(
        context.db,
        visible.map((row) => row.id),
        userId,
      );
      // One access resolution per visible row: the filter above only answered
      // `canView`, and a card also renders `canLearn` and the staff role.
      return Promise.all(
        visible.map(async (row) =>
          toCourseCard(
            row,
            facts,
            await resolveAccess(context.db, context, context.headers, accessInput(row)),
          ),
        ),
      );
    }),

  get: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{id}",
      tags: TAGS,
      summary: "Get a course landing page",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseDetailSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id);
      return buildCourseDetail(context, row);
    }),

  getBySlug: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/by-slug/{slug}",
      tags: TAGS,
      summary: "Get a course by its slug",
    })
    .input(z.object({ slug: z.string().min(1).max(80) }))
    .output(CourseDetailSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const row = await loadCourseBySlug(context.db, organizationId, input.slug);
      return buildCourseDetail(context, row);
    }),

  create: requireOrgPermission({ course: ["create"] })
    .route({ method: "POST", path: "/courses", tags: TAGS, summary: "Create a course" })
    .input(CreateCourseInputSchema)
    .output(CourseSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.title),
        async (candidate) =>
          !!(await context.db.query.course.findFirst({
            where: and(eq(course.organizationId, organizationId), eq(course.slug, candidate)),
          })),
      );

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const row = firstRow(
              await tx
                .insert(course)
                .values({
                  organizationId,
                  slug,
                  title: input.title,
                  tagline: input.tagline ?? null,
                  description: input.description ?? null,
                  visibility: input.visibility,
                  enrollmentPolicy: input.enrollmentPolicy,
                  level: input.level ?? null,
                  language: input.language ?? null,
                  estimatedMinutes: input.estimatedMinutes ?? null,
                  createdBy: userId,
                })
                .returning(),
            );
            // The creator becomes explicit staff, so the course survives them
            // losing an org role and shows them in the authors list.
            await tx.insert(courseMember).values({
              courseId: row.id,
              subject: "user",
              userId,
              role: "owner",
            });
            await recordActivity(tx, {
              organizationId,
              action: "course.created",
              ...activityActor(context),
              courseId: row.id,
              metadata: { title: row.title },
            });
            return toCourse(row);
          }),
        "A course with this slug already exists in the organization",
      );
    }),

  update: protectedProcedure
    .route({ method: "PATCH", path: "/courses/{id}", tags: TAGS, summary: "Update a course" })
    .input(UpdateCourseInputSchema)
    .output(CourseSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id);
      await requireCourseCapability(context.db, context, context.headers, row, "author");

      const { id, slug: requestedSlug, ...rest } = input;
      // Visibility, enrolment policy and seat caps decide who gets in — they are
      // a management decision, not an authoring one.
      const restricted = [
        "visibility",
        "enrollmentPolicy",
        "maxSeats",
        "enrollmentClosesAt",
        "certificateEnabled",
      ] as const;
      if (restricted.some((key) => rest[key] !== undefined)) {
        await requireCourseCapability(context.db, context, context.headers, row, "manage");
      }

      const slug =
        requestedSlug && requestedSlug !== row.slug
          ? await uniqueSlug(
              requestedSlug,
              async (candidate) =>
                !!(await context.db.query.course.findFirst({
                  where: and(
                    eq(course.organizationId, row.organizationId),
                    eq(course.slug, candidate),
                  ),
                })),
            )
          : undefined;

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const updated = firstRow(
              await tx
                .update(course)
                .set({
                  ...(slug ? { slug } : {}),
                  ...(rest.title !== undefined ? { title: rest.title } : {}),
                  ...(rest.tagline !== undefined ? { tagline: rest.tagline ?? null } : {}),
                  ...(rest.description !== undefined
                    ? { description: rest.description ?? null }
                    : {}),
                  ...(rest.thumbnailAssetId !== undefined
                    ? { thumbnailAssetId: rest.thumbnailAssetId ?? null }
                    : {}),
                  ...(rest.visibility !== undefined ? { visibility: rest.visibility } : {}),
                  ...(rest.enrollmentPolicy !== undefined
                    ? { enrollmentPolicy: rest.enrollmentPolicy }
                    : {}),
                  ...(rest.level !== undefined ? { level: rest.level ?? null } : {}),
                  ...(rest.language !== undefined ? { language: rest.language ?? null } : {}),
                  ...(rest.estimatedMinutes !== undefined
                    ? { estimatedMinutes: rest.estimatedMinutes ?? null }
                    : {}),
                  ...(rest.sequential !== undefined ? { sequential: rest.sequential } : {}),
                  ...(rest.completionThreshold !== undefined
                    ? { completionThreshold: rest.completionThreshold }
                    : {}),
                  ...(rest.certificateEnabled !== undefined
                    ? { certificateEnabled: rest.certificateEnabled }
                    : {}),
                  ...(rest.certificateTemplate !== undefined
                    ? { certificateTemplate: rest.certificateTemplate ?? null }
                    : {}),
                  ...(rest.enrollmentClosesAt !== undefined
                    ? { enrollmentClosesAt: rest.enrollmentClosesAt ?? null }
                    : {}),
                  ...(rest.maxSeats !== undefined ? { maxSeats: rest.maxSeats ?? null } : {}),
                })
                .where(eq(course.id, id))
                .returning(),
            );
            await recordActivity(tx, {
              organizationId: row.organizationId,
              action: "course.updated",
              ...activityActor(context),
              courseId: row.id,
              metadata: { title: updated.title },
            });
            return toCourse(updated);
          }),
        "A course with this slug already exists in the organization",
      );
    }),

  publish: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{id}/publish",
      tags: TAGS,
      summary: "Publish a course so learners can find and enrol in it",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id);
      await requireCourseCapability(context.db, context, context.headers, row, "manage");

      // A course with nothing in it would appear in the catalog and open onto an
      // empty page — refuse rather than publish something unusable.
      const [lessons] = await context.db
        .select({ value: count() })
        .from(lesson)
        .where(eq(lesson.courseId, row.id));
      if (Number(lessons?.value ?? 0) === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Add at least one lesson before publishing this course",
        });
      }

      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(course)
            .set({
              status: "published",
              publishedAt: row.publishedAt ?? new Date(),
              archivedAt: null,
            })
            .where(eq(course.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: row.organizationId,
          action: "course.published",
          ...activityActor(context),
          courseId: row.id,
          metadata: { title: updated.title },
        });
        return toCourse(updated);
      });
    }),

  unpublish: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{id}/unpublish",
      tags: TAGS,
      summary: "Take a course back to draft",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id);
      await requireCourseCapability(context.db, context, context.headers, row, "manage");
      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx.update(course).set({ status: "draft" }).where(eq(course.id, row.id)).returning(),
        );
        await recordActivity(tx, {
          organizationId: row.organizationId,
          action: "course.updated",
          ...activityActor(context),
          courseId: row.id,
          metadata: { title: updated.title, status: "draft" },
        });
        return toCourse(updated);
      });
    }),

  archive: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{id}/archive",
      tags: TAGS,
      summary: "Archive a course: read-only for its learners, closed to new ones",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id);
      await requireCourseCapability(context.db, context, context.headers, row, "manage");
      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(course)
            .set({ status: "archived", archivedAt: new Date() })
            .where(eq(course.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: row.organizationId,
          action: "course.archived",
          ...activityActor(context),
          courseId: row.id,
          metadata: { title: updated.title },
        });
        return toCourse(updated);
      });
    }),

  restore: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{id}/restore",
      tags: TAGS,
      summary: "Restore an archived or trashed course",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseSchema)
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id, { includeTrashed: true });
      await requireCourseCapability(context.db, context, context.headers, row, "manage");
      const wasTrashed = row.deletedAt !== null;
      return context.db.transaction(async (tx) => {
        const updated = firstRow(
          await tx
            .update(course)
            .set({
              deletedAt: null,
              deletedBy: null,
              archivedAt: null,
              // Restoring never republishes: an author decides when a course is
              // live again, not the restore.
              status: row.status === "archived" ? "draft" : row.status,
            })
            .where(eq(course.id, row.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId: row.organizationId,
          action: wasTrashed ? "course.untrashed" : "course.restored",
          ...activityActor(context),
          courseId: row.id,
          metadata: { title: updated.title },
        });
        return toCourse(updated);
      });
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/courses/{id}",
      tags: TAGS,
      summary: "Move a course to the trash",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id);
      await requireCourseCapability(context.db, context, context.headers, row, "manage");
      return context.db.transaction(async (tx) => {
        await tx
          .update(course)
          .set({ deletedAt: new Date(), deletedBy: context.session.user.id })
          .where(eq(course.id, row.id));
        await recordActivity(tx, {
          organizationId: row.organizationId,
          action: "course.deleted",
          ...activityActor(context),
          courseId: row.id,
          // The title is denormalized because the row is gone from every view
          // and the FK nulls out on a purge.
          metadata: { id: row.id, title: row.title },
        });
        return { id: row.id };
      });
    }),

  purge: protectedProcedure
    .route({
      method: "DELETE",
      path: "/courses/{id}/purge",
      tags: TAGS,
      summary: "Delete a trashed course for good, with everything in it",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const row = await loadCourse(context.db, input.id, { includeTrashed: true });
      await requireCourseCapability(context.db, context, context.headers, row, "manage");
      if (!row.deletedAt) {
        // Forcing the trash step first is what makes the destructive action
        // recoverable for the window the operator configured.
        throw new ORPCError("BAD_REQUEST", { message: "Move the course to the trash first" });
      }
      return context.db.transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: row.organizationId,
          action: "course.purged",
          ...activityActor(context),
          metadata: { id: row.id, title: row.title },
        });
        // Cascades take the chapters, lessons, enrolments, submissions and
        // assets with it. Certificates survive: they null their `course_id` and
        // keep the snapshot, because a revoked course must not silently unmake
        // the qualifications it granted.
        await tx.delete(course).where(eq(course.id, row.id));
        return { id: row.id };
      });
    }),

  trash: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/trash",
      tags: TAGS,
      summary: "List trashed courses in the active organization",
    })
    .input(z.object({}))
    .output(z.array(CourseSchema))
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const [rows, canView] = await Promise.all([
        context.db.query.course.findMany({
          where: and(eq(course.organizationId, organizationId), isNotNull(course.deletedAt)),
          orderBy: [desc(course.deletedAt)],
        }),
        courseViewFilter(context.db, context, context.headers, organizationId),
      ]);
      return rows.filter((row) => canView(accessInput(row))).map(toCourse);
    }),
};

// ---------------------------------------------------------------------------

/** Assembles the landing page: card facts, authors, price and enrollability. */
async function buildCourseDetail(
  context: AuthedContext,
  row: Awaited<ReturnType<typeof loadCourse>>,
) {
  const access = await resolveAccess(context.db, context, context.headers, accessInput(row));
  if (!access.canView) throw new ORPCError("NOT_FOUND");

  const userId = context.session.user.id;
  const [facts, staff, mine, seats] = await Promise.all([
    loadCourseCardFacts(context.db, [row.id], userId),
    context.db.query.courseMember.findMany({
      where: and(eq(courseMember.courseId, row.id), eq(courseMember.isPublic, true)),
      with: { user: { columns: { id: true, name: true, image: true } } },
    }),
    findEnrollment(context.db, row.id, userId),
    seatsLeft(context.db, row),
  ]);

  const priceRow = await loadCoursePrice(context.db, row.id);
  const enrollability = resolveEnrollability({
    access,
    status: row.status,
    policy: row.enrollmentPolicy,
    enrollment: mine?.status ?? null,
    seatsLeft: seats,
    closed: row.enrollmentClosesAt ? row.enrollmentClosesAt.getTime() <= Date.now() : false,
    hasEntitlement:
      row.enrollmentPolicy === "paid"
        ? await hasCourseEntitlement(context.db, userId, row.id)
        : false,
  });

  return {
    ...toCourseCard(row, facts, access),
    authors: staff
      .filter((member) => member.user)
      .map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.user!.name,
        image: member.user!.image ?? null,
        role: member.role,
      })),
    price: priceRow,
    enrollability,
    seatsLeft: seats,
  };
}

/** The active price for a course, or null when it is not sold. */
async function loadCoursePrice(db: AuthedContext["db"], courseId: string) {
  const rows = await db
    .select({
      productId: product.id,
      priceId: productPrice.id,
      amountCents: productPrice.amountCents,
      currency: productPrice.currency,
      interval: productPrice.interval,
    })
    .from(product)
    .innerJoin(productPrice, eq(productPrice.productId, product.id))
    .where(
      and(eq(product.courseId, courseId), eq(product.active, true), eq(productPrice.active, true)),
    )
    .limit(1);
  return rows[0] ?? null;
}
