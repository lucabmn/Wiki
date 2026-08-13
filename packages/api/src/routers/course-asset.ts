import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { courseAsset, submissionTask } from "@nilovon-wiki/db/schema/index";
import { env } from "@nilovon-wiki/env/server";

import type { AuthedContext } from "../context";
import { protectedProcedure } from "../index";
import { requireCourseCapabilityById, requireCourseLearn } from "../lib/learn-authz";
import { loadCourse, loadCourseAsset } from "../lib/learn-loaders";
import { getStorage } from "../lib/storage";
import { IdSchema } from "../schemas/shared";

const TAGS = ["Course files"];

const CourseAssetSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  courseId: IdSchema.nullable(),
  kind: z.enum(["thumbnail", "video", "document", "submission", "other"]),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  url: z.string(),
  uploadedBy: IdSchema.nullable(),
  createdAt: z.date(),
});

/** Everything about a course file except the bytes, which move over HTTP. */
export const courseAssetRouter = {
  capabilities: protectedProcedure
    .route({
      method: "GET",
      path: "/course-assets/capabilities",
      tags: TAGS,
      summary: "Whether uploads are configured, and how large a file may be",
    })
    .input(z.object({}))
    .output(z.object({ enabled: z.boolean(), maxUploadBytes: z.number().int().positive() }))
    .handler(() => ({
      enabled: getStorage() !== null,
      maxUploadBytes: env.ATTACHMENT_MAX_MB * 1024 * 1024,
    })),

  list: protectedProcedure
    .route({
      method: "GET",
      path: "/courses/{courseId}/assets",
      tags: TAGS,
      summary: "List a course's files",
    })
    .input(
      z.object({
        courseId: IdSchema,
        kind: z.enum(["thumbnail", "video", "document", "other"]).optional(),
      }),
    )
    .output(z.array(CourseAssetSchema))
    .handler(async ({ input, context }) => {
      await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        input.courseId,
        "author",
      );
      const rows = await context.db.query.courseAsset.findMany({
        where: and(
          eq(courseAsset.courseId, input.courseId),
          input.kind ? eq(courseAsset.kind, input.kind) : undefined,
        ),
        orderBy: [desc(courseAsset.createdAt)],
      });
      // Submissions are excluded even from an author's listing: a hand-in is
      // reached through the submission it belongs to, where blind grading and
      // ownership are enforced, never through a flat file browser.
      return rows
        .filter((row) => row.kind !== "submission")
        .map((row) => ({ ...row, url: `/course-assets/${row.id}/inline` }));
    }),

  /**
   * Resolves one asset for the binary proxy in `apps/server`. The proxy calls
   * this rather than reading the row itself, so the download path cannot drift
   * from the rules the RPC surface enforces.
   */
  get: protectedProcedure
    .route({
      method: "GET",
      path: "/course-assets/{id}",
      tags: TAGS,
      summary: "Get a course file's metadata",
    })
    .input(z.object({ id: IdSchema }))
    .output(CourseAssetSchema.extend({ storageKey: z.string() }))
    .handler(async ({ input, context }) => {
      const row = await loadCourseAsset(context.db, input.id);
      await assertAssetRead(context, row);
      return { ...row, url: `/course-assets/${row.id}/inline` };
    }),

  delete: protectedProcedure
    .route({
      method: "DELETE",
      path: "/course-assets/{id}",
      tags: TAGS,
      summary: "Delete a course file",
    })
    .input(z.object({ id: IdSchema }))
    .output(z.object({ id: IdSchema }))
    .handler(async ({ input, context }) => {
      const row = await loadCourseAsset(context.db, input.id);
      if (!row.courseId) throw new ORPCError("FORBIDDEN");
      if (row.kind === "submission") {
        // A hand-in is evidence in a grading decision. Removing it is the
        // learner's own call while their submission is still a draft, and the
        // submission router owns that rule — not a generic file delete.
        throw new ORPCError("FORBIDDEN", {
          message: "Remove the file through the submission it belongs to",
        });
      }
      await requireCourseCapabilityById(
        context.db,
        context,
        context.headers,
        row.courseId,
        "author",
      );

      // Marked before the object store is touched, so a failed delete leaves a
      // marker to retry rather than a row pointing at bytes that are gone.
      await context.db
        .update(courseAsset)
        .set({ deletionPendingAt: new Date() })
        .where(eq(courseAsset.id, row.id));
      const storage = getStorage();
      if (storage) await storage.delete(row.storageKey).catch(() => {});
      await context.db.delete(courseAsset).where(eq(courseAsset.id, row.id));
      return { id: row.id };
    }),
};

/**
 * Who may read one file.
 *
 * Course material follows the course: anyone who may open its lessons may fetch
 * its video. A hand-in is narrower — its author and the people who grade it,
 * and nobody else in the course, because a submission is the learner's work and
 * not course content.
 */
async function assertAssetRead(
  context: AuthedContext,
  row: Awaited<ReturnType<typeof loadCourseAsset>>,
): Promise<void> {
  if (!row.courseId) throw new ORPCError("NOT_FOUND");
  const course = await loadCourse(context.db, row.courseId);

  if (row.kind !== "submission") {
    await requireCourseLearn(context.db, context, context.headers, course);
    return;
  }
  if (row.uploadedBy === context.session.user.id) return;

  const owner = await context.db.query.submissionTask.findFirst({
    where: eq(submissionTask.assetId, row.id),
    columns: { id: true },
  });
  if (!owner) throw new ORPCError("NOT_FOUND");
  await requireCourseCapabilityById(context.db, context, context.headers, course.id, "grade");
}
