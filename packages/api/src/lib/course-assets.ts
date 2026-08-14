import { ORPCError } from "@orpc/server";

import { courseAsset } from "@nilovon-wiki/db/schema/index";

import type { AuthedContext } from "../context";
import { requireCourseCapabilityById, requireCourseLearn } from "./learn-authz";
import { loadCourse } from "./learn-loaders";
import { firstRow } from "./rows";
import { getStorage } from "./storage";

/**
 * Files owned by the learning product — thumbnails, lesson videos, documents
 * and learner hand-ins.
 *
 * Shares the object store with wiki attachments but keys under its own prefix,
 * so a bucket listing is grouped the way the app is and one product's cleanup
 * can never walk into the other's objects.
 */

export type CourseAssetKind = "thumbnail" | "video" | "document" | "submission" | "other";

/**
 * Storage key for a course upload. The original file name is deliberately not
 * part of the key — it lives in the row, which keeps user-controlled text out
 * of storage paths — and the random component means two uploads of the same
 * name never collide.
 */
export function buildCourseStorageKey(courseId: string, fileName: string): string {
  const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
  const safeExtension = /^\.[A-Za-z0-9]{1,12}$/.test(extension) ? extension.toLowerCase() : "";
  return `courses/${courseId}/${crypto.randomUUID()}${safeExtension}`;
}

/**
 * Stores an uploaded file and records its row, in that order, as one operation.
 *
 * Who may upload depends on what the file is for: course material needs an
 * authoring grant, while a hand-in only needs the learner to be enrolled —
 * a learner who could not upload their own submission would have no way to
 * complete an assignment.
 */
export async function createCourseAsset(
  context: AuthedContext,
  input: {
    courseId: string;
    kind: CourseAssetKind;
    file: { name: string; type: string; size: number; body: Blob };
  },
) {
  const storage = getStorage();
  if (!storage) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message: "Uploads are disabled: no object storage is configured (see S3_* in .env).",
    });
  }

  const course = await loadCourse(context.db, input.courseId);
  if (input.kind === "submission") {
    await requireCourseLearn(context.db, context, context.headers, course);
  } else {
    await requireCourseCapabilityById(context.db, context, context.headers, course.id, "author");
  }

  const storageKey = buildCourseStorageKey(course.id, input.file.name);
  await storage.upload(storageKey, input.file.body, { contentType: input.file.type });

  try {
    return await context.db.transaction(async (tx) =>
      firstRow(
        await tx
          .insert(courseAsset)
          .values({
            organizationId: course.organizationId,
            courseId: course.id,
            kind: input.kind,
            fileName: input.file.name,
            mimeType: input.file.type,
            size: input.file.size,
            storageKey,
            uploadedBy: context.session.user.id,
          })
          .returning(),
      ),
    );
  } catch (error) {
    // The bytes are already in the bucket; without this the failed insert would
    // leave an object no row references and nothing ever collects.
    await storage.delete(storageKey).catch(() => {});
    throw error;
  }
}
