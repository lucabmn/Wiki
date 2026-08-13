import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The auth module is mocked so org-permission checks are controllable and no
// db/env is pulled in transitively.
const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { course, member, organization, user } from "@nilovon-wiki/db/schema/index";

import { chapterRouter } from "../../src/routers/chapter";
import { courseRouter } from "../../src/routers/course";
import { lessonRouter } from "../../src/routers/lesson";
import { testContext } from "./context";
import { createTestDb, type TestDb } from "./db";

let db: TestDb;
const now = new Date();

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(user).values([
    { id: "uAuthor", name: "Ada", email: "ada@x.io", createdAt: now, updatedAt: now },
    { id: "uLearner", name: "Leo", email: "leo@x.io", createdAt: now, updatedAt: now },
    { id: "uOutsider", name: "Ola", email: "ola@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values([
    { id: "oA", name: "Acme", slug: "acme", createdAt: now },
    { id: "oB", name: "Other", slug: "other", createdAt: now },
  ]);
  await db.insert(member).values([
    { id: "m1", organizationId: "oA", userId: "uAuthor", role: "member", createdAt: now },
    { id: "m2", organizationId: "oA", userId: "uLearner", role: "member", createdAt: now },
    { id: "m3", organizationId: "oB", userId: "uOutsider", role: "member", createdAt: now },
  ]);
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockClear();
  // Nobody is an org manager unless a test says so: the point of these tests is
  // that course access does NOT fall out of org permissions.
  hasPermission.mockResolvedValue({ success: false });
});

const ctx = (userId: string, org: string | null = "oA") =>
  testContext(db, { userId, activeOrganizationId: org });

/** Creates a course with one chapter and one published lesson. */
async function seedCourse(overrides: Partial<typeof course.$inferInsert> = {}) {
  hasPermission.mockResolvedValue({ success: true });
  const created = await call(
    courseRouter.create,
    { title: "TypeScript", visibility: "organization", enrollmentPolicy: "open" },
    { context: ctx("uAuthor") },
  );
  hasPermission.mockResolvedValue({ success: false });

  const chapter = await call(
    chapterRouter.create,
    { courseId: created.id, title: "Basics" },
    { context: ctx("uAuthor") },
  );
  const lesson = await call(
    lessonRouter.create,
    { chapterId: chapter.id, title: "Types", kind: "dynamic" },
    { context: ctx("uAuthor") },
  );
  await call(
    lessonRouter.update,
    { id: lesson.id, content: { type: "doc", content: [] } },
    { context: ctx("uAuthor") },
  );
  await call(lessonRouter.publish, { id: lesson.id, published: true }, { context: ctx("uAuthor") });
  await call(
    chapterRouter.update,
    { id: chapter.id, published: true },
    { context: ctx("uAuthor") },
  );
  if (Object.keys(overrides).length > 0) {
    await db.update(course).set(overrides).where(eq(course.id, created.id));
  }
  return { courseId: created.id, chapterId: chapter.id, lessonId: lesson.id };
}

describe("course creation", () => {
  it("makes the creator an owner, so the course survives losing an org role", async () => {
    const { courseId } = await seedCourse();
    const detail = await call(courseRouter.get, { id: courseId }, { context: ctx("uAuthor") });
    expect(detail.access.role).toBe("owner");
    expect(detail.access.canManage).toBe(true);
    expect(detail.authors.map((a) => a.userId)).toContain("uAuthor");
  });

  it("derives a unique slug per organization", async () => {
    hasPermission.mockResolvedValue({ success: true });
    const first = await call(
      courseRouter.create,
      { title: "Same Name", visibility: "organization", enrollmentPolicy: "open" },
      { context: ctx("uAuthor") },
    );
    const second = await call(
      courseRouter.create,
      { title: "Same Name", visibility: "organization", enrollmentPolicy: "open" },
      { context: ctx("uAuthor") },
    );
    expect(first.slug).toBe("same-name");
    expect(second.slug).toBe("same-name-2");
  });
});

describe("catalog visibility", () => {
  it("hides a draft from everyone but its staff", async () => {
    const { courseId } = await seedCourse();
    const asAuthor = await call(courseRouter.list, {}, { context: ctx("uAuthor") });
    expect(asAuthor.map((row) => row.id)).toContain(courseId);

    const asLearner = await call(courseRouter.list, {}, { context: ctx("uLearner") });
    expect(asLearner.map((row) => row.id)).not.toContain(courseId);
  });

  it("shows a published organization course to any member of that org", async () => {
    const { courseId } = await seedCourse();
    await call(courseRouter.publish, { id: courseId }, { context: ctx("uAuthor") });

    const asLearner = await call(courseRouter.list, {}, { context: ctx("uLearner") });
    expect(asLearner.map((row) => row.id)).toContain(courseId);
  });

  it("never shows a course to a member of a different organization", async () => {
    const { courseId } = await seedCourse();
    await call(courseRouter.publish, { id: courseId }, { context: ctx("uAuthor") });

    const asOutsider = await call(courseRouter.list, {}, { context: ctx("uOutsider", "oB") });
    expect(asOutsider.map((row) => row.id)).not.toContain(courseId);
    await expect(
      call(courseRouter.get, { id: courseId }, { context: ctx("uOutsider", "oB") }),
    ).rejects.toThrow();
  });

  it("keeps a private course out of the catalog for members who are not enrolled", async () => {
    const { courseId } = await seedCourse({ visibility: "private" });
    await call(courseRouter.publish, { id: courseId }, { context: ctx("uAuthor") });

    const asLearner = await call(courseRouter.list, {}, { context: ctx("uLearner") });
    expect(asLearner.map((row) => row.id)).not.toContain(courseId);
  });
});

describe("publishing", () => {
  it("refuses to publish a course with no lessons", async () => {
    hasPermission.mockResolvedValue({ success: true });
    const empty = await call(
      courseRouter.create,
      { title: "Empty", visibility: "organization", enrollmentPolicy: "open" },
      { context: ctx("uAuthor") },
    );
    hasPermission.mockResolvedValue({ success: false });
    await expect(
      call(courseRouter.publish, { id: empty.id }, { context: ctx("uAuthor") }),
    ).rejects.toThrow(/at least one lesson/);
  });

  it("refuses to publish a video lesson with no file", async () => {
    const { chapterId } = await seedCourse();
    const video = await call(
      lessonRouter.create,
      { chapterId, title: "Intro", kind: "video" },
      { context: ctx("uAuthor") },
    );
    await expect(
      call(lessonRouter.publish, { id: video.id, published: true }, { context: ctx("uAuthor") }),
    ).rejects.toThrow(/needs a file/);
  });
});

describe("authoring authorization", () => {
  it("refuses an org member who holds every content permission but is not staff", async () => {
    const { chapterId } = await seedCourse();
    // Everything except org *management* is granted. That is the discriminating
    // case: a colleague with full `page:*`/`course:*` content rights still gets
    // no authoring grant on a course they are not staff on. Only org
    // owners/admins — who hold `member:["update"]` — escalate, and the next
    // assertion pins that.
    hasPermission.mockImplementation(async ({ body }) => ({
      success: !("member" in (body.permissions ?? {})),
    }));
    await expect(
      call(
        chapterRouter.update,
        { id: chapterId, title: "Hijacked" },
        { context: ctx("uLearner") },
      ),
    ).rejects.toThrow();
  });

  it("lets an org owner administer a course they are not staff on", async () => {
    const { chapterId } = await seedCourse();
    hasPermission.mockResolvedValue({ success: true });
    const updated = await call(
      chapterRouter.update,
      { id: chapterId, title: "By the org owner" },
      { context: ctx("uLearner") },
    );
    expect(updated.title).toBe("By the org owner");
  });
});

describe("outline", () => {
  it("locks every lesson for a member who can see the course but has not enrolled", async () => {
    const { courseId } = await seedCourse();
    await call(courseRouter.publish, { id: courseId }, { context: ctx("uAuthor") });

    const outline = await call(lessonRouter.outline, { courseId }, { context: ctx("uLearner") });
    const lessons = outline.chapters.flatMap((chapter) => chapter.lessons);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.locked).toBe(true);
    expect(lessons[0]?.lockReason).toBe("not_enrolled");
  });

  it("hides unpublished material from learners and shows it to staff", async () => {
    const { courseId, chapterId } = await seedCourse();
    await call(courseRouter.publish, { id: courseId }, { context: ctx("uAuthor") });
    await call(
      lessonRouter.create,
      { chapterId, title: "Draft lesson", kind: "dynamic" },
      { context: ctx("uAuthor") },
    );

    const staffView = await call(lessonRouter.outline, { courseId }, { context: ctx("uAuthor") });
    expect(staffView.chapters[0]?.lessons).toHaveLength(2);
    expect(staffView.isStaff).toBe(true);

    const learnerView = await call(
      lessonRouter.outline,
      { courseId },
      { context: ctx("uLearner") },
    );
    expect(learnerView.chapters[0]?.lessons).toHaveLength(1);
  });
});
