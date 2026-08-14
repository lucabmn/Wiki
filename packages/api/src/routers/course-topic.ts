import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@nilovon-wiki/db";
import { courseTopic, courseTopicLink } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { protectedProcedure, requireActiveOrg, requireOrgPermission } from "../index";
import { activityActor, recordActivity } from "../lib/activity";
import { requireCourseCapability, viewableCourses } from "../lib/learn-authz";
import { loadCourse } from "../lib/learn-loaders";
import { mapUniqueViolation } from "../lib/pg-errors";
import { firstRow } from "../lib/rows";
import { slugify, uniqueSlug } from "../lib/slug";
import {
  CourseTopicSchema,
  CreateCourseTopicInputSchema,
  SetCourseTopicsInputSchema,
} from "../schemas/course";
import { IdSchema } from "../schemas/shared";

/**
 * Catalog topics. Org-scoped vocabulary shared by every course, unlike
 * `wiki.tag` which belongs to one space.
 *
 * Topic CRUD is gated on the org grants alone because a topic has no ACL of its
 * own — there is no resource to resolve a capability against. Attaching topics
 * to a course is a different question, and answered by the course: it needs
 * `author` on that course, not an org grant.
 */

const TAGS = ["Course topics"];

/**
 * No update contract exists in `schemas/course.ts`; derived from the create one
 * so the two cannot drift apart as fields are added.
 */
const UpdateCourseTopicInputSchema = CreateCourseTopicInputSchema.partial().extend({
  id: IdSchema,
});

/**
 * How many courses sit behind each topic *for this caller*.
 *
 * Counting every link would advertise private and draft courses through the
 * catalog facets — a number next to a topic is a small leak, but it is still a
 * leak, and the count the client renders has to match the list it gets back.
 */
async function visibleCourseCounts(
  db: Database,
  context: AuthedContext,
  headers: Headers,
  organizationId: string,
  topicIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (topicIds.length === 0) return counts;
  const visible = await viewableCourses(db, context, headers, organizationId);
  if (visible.length === 0) return counts;
  const links = await db
    .select({ topicId: courseTopicLink.topicId })
    .from(courseTopicLink)
    .where(
      and(inArray(courseTopicLink.topicId, topicIds), inArray(courseTopicLink.courseId, visible)),
    );
  for (const link of links) counts.set(link.topicId, (counts.get(link.topicId) ?? 0) + 1);
  return counts;
}

/**
 * Loads a topic and refuses one that belongs to another organization.
 *
 * `requireOrgPermission` checks the caller's *active* org, so without this an
 * admin of org A would pass the gate and then mutate org B's row by id.
 * NOT_FOUND rather than FORBIDDEN: confirming the id exists is itself a leak.
 */
async function loadTopicInOrg(db: Database, id: string, organizationId: string) {
  const row = await db.query.courseTopic.findFirst({ where: eq(courseTopic.id, id) });
  if (!row || row.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", { message: "Topic not found" });
  }
  return row;
}

export const courseTopicRouter = {
  list: protectedProcedure
    .route({
      method: "GET",
      path: "/course-topics",
      tags: TAGS,
      summary: "List the catalog topics of the active organization",
    })
    .input(z.object({}))
    .output(z.array(CourseTopicSchema))
    .handler(async ({ context }) => {
      const organizationId = requireActiveOrg(context);
      const topics = await context.db.query.courseTopic.findMany({
        where: eq(courseTopic.organizationId, organizationId),
        orderBy: [asc(courseTopic.name)],
      });
      const counts = await visibleCourseCounts(
        context.db,
        context,
        context.headers,
        organizationId,
        topics.map((topic) => topic.id),
      );
      return topics.map((topic) => ({ ...topic, courseCount: counts.get(topic.id) ?? 0 }));
    }),

  create: requireOrgPermission({ course: ["create"] })
    .route({ method: "POST", path: "/course-topics", tags: TAGS, summary: "Create a topic" })
    .input(CreateCourseTopicInputSchema)
    .output(CourseTopicSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const slug = await uniqueSlug(
        input.slug ?? slugify(input.name),
        async (candidate) =>
          !!(await context.db.query.courseTopic.findFirst({
            where: and(
              eq(courseTopic.organizationId, organizationId),
              eq(courseTopic.slug, candidate),
            ),
          })),
      );
      // A single insert, and the audit feed has no action for catalog
      // vocabulary — nothing here needs a transaction.
      const row = await mapUniqueViolation(
        async () =>
          firstRow(
            await context.db
              .insert(courseTopic)
              .values({ organizationId, slug, name: input.name, color: input.color ?? null })
              .returning(),
          ),
        "A topic with this slug already exists in the organization",
      );
      return { ...row, courseCount: 0 };
    }),

  update: requireOrgPermission({ course: ["update"] })
    .route({ method: "PATCH", path: "/course-topics/{id}", tags: TAGS, summary: "Update a topic" })
    .input(UpdateCourseTopicInputSchema)
    .output(CourseTopicSchema)
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await loadTopicInOrg(context.db, input.id, organizationId);
      const slug =
        input.slug && input.slug !== existing.slug
          ? await uniqueSlug(
              input.slug,
              async (candidate) =>
                !!(await context.db.query.courseTopic.findFirst({
                  where: and(
                    eq(courseTopic.organizationId, organizationId),
                    eq(courseTopic.slug, candidate),
                  ),
                })),
            )
          : undefined;

      const row = await mapUniqueViolation(
        async () =>
          firstRow(
            await context.db
              .update(courseTopic)
              .set({
                ...(slug ? { slug } : {}),
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.color !== undefined ? { color: input.color ?? null } : {}),
              })
              .where(eq(courseTopic.id, existing.id))
              .returning(),
          ),
        "A topic with this slug already exists in the organization",
      );
      const counts = await visibleCourseCounts(
        context.db,
        context,
        context.headers,
        organizationId,
        [row.id],
      );
      return { ...row, courseCount: counts.get(row.id) ?? 0 };
    }),

  delete: requireOrgPermission({ course: ["delete"] })
    .route({ method: "DELETE", path: "/course-topics/{id}", tags: TAGS, summary: "Delete a topic" })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const organizationId = requireActiveOrg(context);
      const existing = await loadTopicInOrg(context.db, input.id, organizationId);
      // The links go with it (`ON DELETE CASCADE`); the courses themselves are
      // untouched — losing a facet must never lose a course.
      await context.db.delete(courseTopic).where(eq(courseTopic.id, existing.id));
      return { id: existing.id };
    }),

  setForCourse: protectedProcedure
    .route({
      method: "POST",
      path: "/courses/{courseId}/topics",
      tags: TAGS,
      summary: "Replace the topics a course is filed under",
    })
    .input(SetCourseTopicsInputSchema)
    .output(z.array(CourseTopicSchema))
    .handler(async ({ input, context }) => {
      const courseRow = await loadCourse(context.db, input.courseId);
      await requireCourseCapability(context.db, context, context.headers, courseRow, "author");

      // The same topic sent twice would collide on `course_topic_link_uq`.
      const topicIds = [...new Set(input.topicIds)];
      const topics = topicIds.length
        ? await context.db.query.courseTopic.findMany({
            where: and(
              eq(courseTopic.organizationId, courseRow.organizationId),
              inArray(courseTopic.id, topicIds),
            ),
            orderBy: [asc(courseTopic.name)],
          })
        : [];
      // The foreign key only checks that a topic exists, so without this a
      // client-supplied id could file the course under another organization's
      // topic — and the endpoint would double as a cross-tenant existence oracle.
      if (topics.length !== topicIds.length) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Some topics do not belong to this organization",
        });
      }

      await context.db.transaction(async (tx) => {
        // Replace rather than diff: the set is small and bounded at 20, and one
        // delete + one insert is atomic where a diff is three round trips.
        await tx.delete(courseTopicLink).where(eq(courseTopicLink.courseId, courseRow.id));
        if (topicIds.length) {
          await tx
            .insert(courseTopicLink)
            .values(topicIds.map((topicId) => ({ courseId: courseRow.id, topicId })));
        }
        await recordActivity(tx, {
          organizationId: courseRow.organizationId,
          action: "course.updated",
          ...activityActor(context),
          courseId: courseRow.id,
          metadata: { title: courseRow.title, topics: topics.map((topic) => topic.name) },
        });
      });

      const counts = await visibleCourseCounts(
        context.db,
        context,
        context.headers,
        courseRow.organizationId,
        topicIds,
      );
      return topics.map((topic) => ({ ...topic, courseCount: counts.get(topic.id) ?? 0 }));
    }),
};
