import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gt, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { collectionCourse, courseCollection } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import type { CourseAccessInput } from "../lib/course-access";
import { loadCourseCardFacts, toCourseCard } from "../lib/course-cards";
import { generateKeyBetween } from "../lib/fractional";
import { courseViewFilter, requireCourseView, resolveAccess } from "../lib/learn-authz";
import { loadCollection, loadCourse } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CourseCollectionDetailSchema,
  CourseCollectionSchema,
  CollectionCourseInputSchema,
  CreateCollectionInputSchema,
  UpdateCollectionInputSchema,
} from "../schemas/course";
import { IdSchema } from "../schemas/shared";

/**
 * Collections ("learning paths"): a curated, ordered set of courses.
 *
 * A collection is an org-level object with no ACL of its own, so curating one is
 * gated on the org course grants — there is no per-collection resource to
 * resolve a capability against. That is *not* a hole in the course rules: every
 * course a collection hands out is still filtered through the caller's own
 * course access on the way out, so a path can never surface a course its reader
 * would not have found in the catalog.
 */

const TAGS = ["Course collections"];

/** One membership row, as returned by the ordering mutations. */
const CollectionCourseSchema = z.object({
  collectionId: IdSchema,
  courseId: IdSchema,
  position: z.string(),
});

type CollectionRow = Awaited<ReturnType<typeof loadCollection>>;

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

/**
 * Loads a collection inside the caller's active organization.
 *
 * `requireOrgPermission` checks the *active* org, so without this an admin of
 * org A would pass the gate and then read or mutate org B's collection by id.
 * NOT_FOUND rather than FORBIDDEN: confirming that the id exists is itself a leak.
 */
async function loadCollectionInOrg(
  db: Database,
  id: string,
  organizationId: string,
): Promise<CollectionRow> {
  const row = await loadCollection(db, id);
  if (row.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "Collection not found" });
  }
  return row;
}

/**
 * A private collection is a draft in progress: only the person assembling it
 * sees it, which is what lets a path be built course by course in the open
 * without half of it showing up in everyone's catalog.
 */
function assertCollectionVisible(row: CollectionRow, userId: string): void {
  if (row.visibility === "private" && row.createdBy !== userId) {
    throw new ORPCError("NOT_FOUND", { message: "Collection not found" });
  }
}

/**
 * How many courses each collection holds *for this caller*. Counting the rows
 * would promise courses the reader cannot open, and the number on a card has to
 * match the list behind it.
 */
async function visibleCourseCounts(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  organizationId: string,
  collectionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (collectionIds.length === 0) return counts;
  const canView = await courseViewFilter(db, context, headers, organizationId);
  const rows = await db.query.collectionCourse.findMany({
    where: inArray(collectionCourse.collectionId, collectionIds),
    with: { course: true },
  });
  for (const row of rows) {
    if (!row.course || row.course.deletedAt) continue;
    if (!canView(accessInput(row.course))) continue;
    counts.set(row.collectionId, (counts.get(row.collectionId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fractional position for an insert or a move: after `afterCourseId`, or at the
 * end when it is omitted. `movedCourseId` excludes the row being moved from its
 * own neighbourhood, which would otherwise anchor it to itself.
 */
async function positionFor(
  db: Database,
  collectionId: string,
  afterCourseId: string | null | undefined,
  movedCourseId?: string,
): Promise<string> {
  const notMoved = movedCourseId ? ne(collectionCourse.courseId, movedCourseId) : undefined;
  if (!afterCourseId) {
    const last = await db.query.collectionCourse.findFirst({
      where: and(eq(collectionCourse.collectionId, collectionId), notMoved),
      orderBy: [desc(collectionCourse.position)],
      columns: { position: true },
    });
    // `generateKeyBetween(null, null)` is "a0" — the column default, so an
    // empty collection and a freshly seeded one agree on the first key.
    return generateKeyBetween(last?.position ?? null, null);
  }
  const anchor = await db.query.collectionCourse.findFirst({
    where: and(
      eq(collectionCourse.collectionId, collectionId),
      eq(collectionCourse.courseId, afterCourseId),
    ),
    columns: { position: true },
  });
  if (!anchor) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The course to insert after is not in this collection",
    });
  }
  const next = await db.query.collectionCourse.findFirst({
    where: and(
      eq(collectionCourse.collectionId, collectionId),
      gt(collectionCourse.position, anchor.position),
      notMoved,
    ),
    orderBy: [asc(collectionCourse.position)],
    columns: { position: true },
  });
  return generateKeyBetween(anchor.position, next?.position ?? null);
}

/** Resolves the `published` flag onto the timestamp the column actually holds. */
function publishedAtFor(row: CollectionRow, published: boolean | undefined): Date | null {
  if (published === undefined) return row.publishedAt;
  // Re-publishing keeps the original date: a path's "published on" is when it
  // first went out, not when it was last edited.
  return published ? (row.publishedAt ?? new Date()) : null;
}

export const courseCollectionRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/course-collections",
      tags: TAGS,
      summary: "List the learning paths of the active organization",
    })
    .input(z.object({}))
    .output(z.array(CourseCollectionSchema))
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      const rows = await context.db.query.courseCollection.findMany({
        where: eq(courseCollection.organizationId, organizationId),
        orderBy: [asc(courseCollection.name)],
      });
      const visible = rows.filter(
        (row) => row.visibility !== "private" || row.createdBy === userId,
      );
      const counts = await visibleCourseCounts(
        context.db,
        context,
        context.headers,
        organizationId,
        visible.map((row) => row.id),
      );
      return visible.map((row) => ({ ...row, courseCount: counts.get(row.id) ?? 0 }));
    }),

  get: protectedProcedure
    .route({
      method: "GET",
      path: "/course-collections/{id}",
      tags: TAGS,
      summary: "Get a learning path with the courses the caller may see",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseCollectionDetailSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const userId = context.session.user.id;
      const row = await loadCollectionInOrg(context.db, input.id, organizationId);
      assertCollectionVisible(row, userId);

      const [links, canView] = await Promise.all([
        context.db.query.collectionCourse.findMany({
          where: eq(collectionCourse.collectionId, row.id),
          orderBy: [asc(collectionCourse.position)],
          with: { course: true },
        }),
        courseViewFilter(context.db, context, context.headers, organizationId),
      ]);

      // Membership in a collection grants nothing. A path assembled by a
      // curator with wide access must not become a back door into the private
      // courses it lists, so every course is re-checked against *this* reader.
      const courses = links
        .map((link) => link.course)
        .filter((course) => course && !course.deletedAt && canView(accessInput(course)));

      const facts = await loadCourseCardFacts(
        context.db,
        courses.map((course) => course.id),
        userId,
      );
      const cards = await Promise.all(
        courses.map(async (course) =>
          toCourseCard(
            course,
            facts,
            await resolveAccess(context.db, context, context.headers, accessInput(course)),
          ),
        ),
      );
      return { ...row, courseCount: cards.length, courses: cards };
    }),

  create: requireOrgPermission({ course: ["create"] })
    .route({
      method: "POST",
      path: "/course-collections",
      tags: TAGS,
      summary: "Create a learning path",
    })
    .input(CreateCollectionInputSchema)
    .output(CourseCollectionSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.name),
        async (candidate) =>
          !!(await context.db.query.courseCollection.findFirst({
            where: and(
              eq(courseCollection.organizationId, organizationId),
              eq(courseCollection.slug, candidate),
            ),
          })),
      );

      return mapUniqueViolation(
        () =>
          context.db.transaction(async (tx) => {
            const row = firstRow(
              await tx
                .insert(courseCollection)
                .values({
                  organizationId,
                  slug,
                  name: input.name,
                  description: input.description ?? null,
                  visibility: input.visibility,
                  createdBy: context.session.user.id,
                })
                .returning(),
            );
            await recordActivity(tx, {
              organizationId,
              action: "collection.created",
              ...activityActor(context),
              metadata: { id: row.id, name: row.name },
            });
            return { ...row, courseCount: 0 };
          }),
        "A collection with this slug already exists in the organization",
      );
    }),

  update: requireOrgPermission({ course: ["update"] })
    .route({
      method: "PATCH",
      path: "/course-collections/{id}",
      tags: TAGS,
      summary: "Update a learning path",
    })
    .input(UpdateCollectionInputSchema)
    .output(CourseCollectionSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await loadCollectionInOrg(context.db, input.id, organizationId);

      const updated = await context.db.transaction(async (tx) => {
        const row = firstRow(
          await tx
            .update(courseCollection)
            .set({
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.description !== undefined
                ? { description: input.description ?? null }
                : {}),
              ...(input.thumbnailAssetId !== undefined
                ? { thumbnailAssetId: input.thumbnailAssetId ?? null }
                : {}),
              ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
              publishedAt: publishedAtFor(existing, input.published),
            })
            .where(eq(courseCollection.id, existing.id))
            .returning(),
        );
        await recordActivity(tx, {
          organizationId,
          action: "collection.updated",
          ...activityActor(context),
          metadata: { id: row.id, name: row.name },
        });
        return row;
      });

      const counts = await visibleCourseCounts(
        context.db,
        context,
        context.headers,
        organizationId,
        [updated.id],
      );
      return { ...updated, courseCount: counts.get(updated.id) ?? 0 };
    }),

  delete: requireOrgPermission({ course: ["delete"] })
    .route({
      method: "DELETE",
      path: "/course-collections/{id}",
      tags: TAGS,
      summary: "Delete a learning path",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await loadCollectionInOrg(context.db, input.id, organizationId);
      return context.db.transaction(async (tx) => {
        // Only the curation is deleted; the membership rows cascade and the
        // courses stay exactly where they were.
        await tx.delete(courseCollection).where(eq(courseCollection.id, existing.id));
        await recordActivity(tx, {
          organizationId,
          action: "collection.deleted",
          ...activityActor(context),
          // Denormalized: the row is gone by the time anyone reads the log.
          metadata: { id: existing.id, name: existing.name },
        });
        return { id: existing.id };
      });
    }),

  addCourse: requireOrgPermission({ course: ["update"] })
    .route({
      method: "POST",
      path: "/course-collections/{collectionId}/courses",
      tags: TAGS,
      summary: "Add a course to a learning path",
    })
    .input(CollectionCourseInputSchema)
    .output(CollectionCourseSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const collection = await loadCollectionInOrg(context.db, input.collectionId, organizationId);
      const courseRow = await loadCourse(context.db, input.courseId);
      // A curator may only add a course they can see themselves — otherwise the
      // collection becomes a way to discover private courses by id.
      await requireCourseView(context.db, context, context.headers, courseRow);
      if (courseRow.organizationId !== collection.organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The course is not in this collection's organization",
        });
      }

      const position = await positionFor(context.db, collection.id, input.afterCourseId);
      return context.db.transaction(async (tx) => {
        const rows = await tx
          .insert(collectionCourse)
          .values({ collectionId: collection.id, courseId: courseRow.id, position })
          .onConflictDoNothing()
          .returning();
        const inserted = rows[0];
        if (!inserted) {
          throw new ORPCError("CONFLICT", { message: "The course is already in this collection" });
        }
        await recordActivity(tx, {
          organizationId,
          action: "collection.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { id: collection.id, name: collection.name, added: courseRow.title },
        });
        return {
          collectionId: inserted.collectionId,
          courseId: inserted.courseId,
          position: inserted.position,
        };
      });
    }),

  removeCourse: requireOrgPermission({ course: ["update"] })
    .route({
      method: "DELETE",
      path: "/course-collections/{collectionId}/courses/{courseId}",
      tags: TAGS,
      summary: "Remove a course from a learning path",
    })
    .input(z.object({ collectionId: IdSchema, courseId: IdSchema }))
    .output(z.object({ collectionId: IdSchema, courseId: IdSchema }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const collection = await loadCollectionInOrg(context.db, input.collectionId, organizationId);
      return context.db.transaction(async (tx) => {
        const removed = await tx
          .delete(collectionCourse)
          .where(
            and(
              eq(collectionCourse.collectionId, collection.id),
              eq(collectionCourse.courseId, input.courseId),
            ),
          )
          .returning({ courseId: collectionCourse.courseId });
        if (removed.length === 0) {
          throw new ORPCError("NOT_FOUND", { message: "The course is not in this collection" });
        }
        await recordActivity(tx, {
          organizationId,
          action: "collection.updated",
          ...activityActor(context),
          courseId: input.courseId,
          metadata: { id: collection.id, name: collection.name, removed: input.courseId },
        });
        return { collectionId: collection.id, courseId: input.courseId };
      });
    }),

  moveCourse: requireOrgPermission({ course: ["update"] })
    .route({
      method: "POST",
      path: "/course-collections/{collectionId}/courses/{courseId}/move",
      tags: TAGS,
      summary: "Reorder a course within a learning path",
    })
    .input(CollectionCourseInputSchema)
    .output(CollectionCourseSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const collection = await loadCollectionInOrg(context.db, input.collectionId, organizationId);
      const existing = await context.db.query.collectionCourse.findFirst({
        where: and(
          eq(collectionCourse.collectionId, collection.id),
          eq(collectionCourse.courseId, input.courseId),
        ),
      });
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "The course is not in this collection" });
      }
      if (input.afterCourseId === input.courseId) {
        throw new ORPCError("BAD_REQUEST", { message: "A course cannot be placed after itself" });
      }

      // Fractional keys mean a reorder writes one row: the neighbours keep the
      // positions they already have.
      const position = await positionFor(
        context.db,
        collection.id,
        input.afterCourseId,
        input.courseId,
      );
      return context.db.transaction(async (tx) => {
        await tx
          .update(collectionCourse)
          .set({ position })
          .where(eq(collectionCourse.id, existing.id));
        await recordActivity(tx, {
          organizationId,
          action: "collection.updated",
          ...activityActor(context),
          courseId: input.courseId,
          metadata: { id: collection.id, name: collection.name, moved: input.courseId },
        });
        return { collectionId: collection.id, courseId: input.courseId, position };
      });
    }),
};
