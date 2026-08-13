import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { hasPermission } = vi.hoisted(() => ({ hasPermission: vi.fn() }));
vi.mock("@nilovon-wiki/auth", () => ({ auth: { api: { hasPermission } } }));

import { course, member, organization, user } from "@nilovon-wiki/db/schema/index";

import { certificateRouter } from "../../src/routers/certificate";
import { chapterRouter } from "../../src/routers/chapter";
import { courseRouter } from "../../src/routers/course";
import { enrollmentRouter } from "../../src/routers/enrollment";
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
    { id: "uOther", name: "Mia", email: "mia@x.io", createdAt: now, updatedAt: now },
  ]);
  await db.insert(organization).values({ id: "oA", name: "Acme", slug: "acme", createdAt: now });
  await db.insert(member).values([
    { id: "m1", organizationId: "oA", userId: "uAuthor", role: "member", createdAt: now },
    { id: "m2", organizationId: "oA", userId: "uLearner", role: "member", createdAt: now },
    { id: "m3", organizationId: "oA", userId: "uOther", role: "member", createdAt: now },
  ]);
});
afterAll(async () => {
  await db.$end();
});
beforeEach(() => {
  hasPermission.mockClear();
  hasPermission.mockResolvedValue({ success: false });
});

const ctx = (userId: string) => testContext(db, { userId, activeOrganizationId: "oA" });

/**
 * A published course with `lessonCount` published lessons in one chapter.
 * `overrides` are applied to the course row after creation, which is how a test
 * sets the columns that only exist to change enrolment or completion rules.
 */
async function publishedCourse(
  lessonCount = 2,
  overrides: Partial<typeof course.$inferInsert> = {},
) {
  hasPermission.mockResolvedValue({ success: true });
  const created = await call(
    courseRouter.create,
    {
      title: `Kurs ${Math.random().toString(36).slice(2, 8)}`,
      visibility: "organization",
      enrollmentPolicy: "open",
    },
    { context: ctx("uAuthor") },
  );
  hasPermission.mockResolvedValue({ success: false });

  const chapter = await call(
    chapterRouter.create,
    { courseId: created.id, title: "Kapitel" },
    { context: ctx("uAuthor") },
  );
  await call(
    chapterRouter.update,
    { id: chapter.id, published: true },
    { context: ctx("uAuthor") },
  );

  const lessonIds: string[] = [];
  for (let index = 0; index < lessonCount; index++) {
    const lesson = await call(
      lessonRouter.create,
      { chapterId: chapter.id, title: `Lektion ${index + 1}`, kind: "dynamic" },
      { context: ctx("uAuthor") },
    );
    await call(
      lessonRouter.update,
      { id: lesson.id, content: { type: "doc", content: [] } },
      { context: ctx("uAuthor") },
    );
    await call(
      lessonRouter.publish,
      { id: lesson.id, published: true },
      { context: ctx("uAuthor") },
    );
    lessonIds.push(lesson.id);
  }

  await call(courseRouter.publish, { id: created.id }, { context: ctx("uAuthor") });
  if (Object.keys(overrides).length > 0) {
    await db.update(course).set(overrides).where(eq(course.id, created.id));
  }
  return { courseId: created.id, chapterId: chapter.id, lessonIds };
}

describe("enrolling", () => {
  it("admits anyone who can see an open course", async () => {
    const { courseId } = await publishedCourse();
    const enrollment = await call(
      enrollmentRouter.enroll,
      { courseId },
      { context: ctx("uLearner") },
    );
    expect(enrollment.status).toBe("active");
    expect(enrollment.source).toBe("self");
  });

  it("refuses self-enrolment in an invite-only course, and names the reason", async () => {
    const { courseId } = await publishedCourse(1, { enrollmentPolicy: "invite" });
    await expect(
      call(enrollmentRouter.enroll, { courseId }, { context: ctx("uOther") }),
    ).rejects.toThrow(/invite_only/);
  });

  it("parks a request policy as pending until the course team decides", async () => {
    const { courseId } = await publishedCourse(1, { enrollmentPolicy: "request" });
    const requested = await call(
      enrollmentRouter.enroll,
      { courseId },
      { context: ctx("uLearner") },
    );
    expect(requested.status).toBe("pending");

    const decided = await call(
      enrollmentRouter.decide,
      { id: requested.id, approve: true },
      { context: ctx("uAuthor") },
    );
    expect(decided.status).toBe("active");
  });

  it("refuses when every seat is taken", async () => {
    const { courseId } = await publishedCourse(1, { maxSeats: 1 });
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });
    await expect(
      call(enrollmentRouter.enroll, { courseId }, { context: ctx("uOther") }),
    ).rejects.toThrow(/full/);
  });

  it("keeps the progress when someone leaves and comes back", async () => {
    const { courseId, lessonIds } = await publishedCourse(2);
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });
    await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: true },
      { context: ctx("uLearner") },
    );

    const enrollment = (
      await call(enrollmentRouter.listMine, {}, { context: ctx("uLearner") })
    ).find((row) => row.courseId === courseId)!;
    expect(enrollment.progressPercent).toBe(50);

    await call(enrollmentRouter.leave, { id: enrollment.id }, { context: ctx("uLearner") });
    const rejoined = await call(
      enrollmentRouter.enroll,
      { courseId },
      { context: ctx("uLearner") },
    );
    // Dropped, not deleted — the lesson they finished is still finished.
    expect(rejoined.id).toBe(enrollment.id);
    expect(rejoined.progressPercent).toBe(50);
  });
});

describe("progress", () => {
  it("refuses to record progress for somebody who is not enrolled", async () => {
    const { lessonIds } = await publishedCourse(1);
    await expect(
      call(
        enrollmentRouter.complete,
        { lessonId: lessonIds[0]!, completed: true },
        { context: ctx("uOther") },
      ),
    ).rejects.toThrow();
  });

  it("never lets the furthest point regress", async () => {
    const { courseId, lessonIds } = await publishedCourse(1);
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });

    await call(
      enrollmentRouter.track,
      { lessonId: lessonIds[0]!, furthestPercent: 80, positionSeconds: 240 },
      { context: ctx("uLearner") },
    );
    const rewound = await call(
      enrollmentRouter.track,
      { lessonId: lessonIds[0]!, furthestPercent: 5, positionSeconds: 15 },
      { context: ctx("uLearner") },
    );
    expect(rewound.progress.furthestPercent).toBe(80);
    // The resume point does follow the learner back — that is a different fact
    // from how much of the lesson they have seen.
    expect(rewound.progress.positionSeconds).toBe(15);
  });

  it("completes the course once the threshold is crossed", async () => {
    const { courseId, lessonIds } = await publishedCourse(2);
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });

    const halfway = await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: true },
      { context: ctx("uLearner") },
    );
    expect(halfway.courseProgressPercent).toBe(50);
    expect(halfway.courseCompleted).toBe(false);

    const done = await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[1]!, completed: true },
      { context: ctx("uLearner") },
    );
    expect(done.courseProgressPercent).toBe(100);
    expect(done.courseCompleted).toBe(true);
  });

  it("issues exactly one certificate, and only when the course grants one", async () => {
    const { courseId, lessonIds } = await publishedCourse(1, { certificateEnabled: true });
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });

    const done = await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: true },
      { context: ctx("uLearner") },
    );
    expect(done.certificateId).not.toBeNull();

    // Re-running the completion check must not print a second copy.
    await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: false },
      { context: ctx("uLearner") },
    );
    await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: true },
      { context: ctx("uLearner") },
    );
    const mine = await call(certificateRouter.listMine, {}, { context: ctx("uLearner") });
    expect(mine.filter((row) => row.courseId === courseId)).toHaveLength(1);
  });

  it("verifies a certificate by serial without a session", async () => {
    const { courseId, lessonIds } = await publishedCourse(1, { certificateEnabled: true });
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });
    await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: true },
      { context: ctx("uLearner") },
    );
    const [issued] = (
      await call(certificateRouter.listMine, {}, { context: ctx("uLearner") })
    ).filter((row) => row.courseId === courseId);

    const verified = await call(
      certificateRouter.verify,
      { serial: issued!.serial },
      { context: testContext(db, { userId: "", activeOrganizationId: null }) },
    );
    expect(verified.status).toBe("issued");
  });
});

describe("sequential courses", () => {
  it("locks every lesson after the first unfinished required one", async () => {
    const { courseId, lessonIds } = await publishedCourse(3, { sequential: true });
    await call(enrollmentRouter.enroll, { courseId }, { context: ctx("uLearner") });

    const before = await call(lessonRouter.outline, { courseId }, { context: ctx("uLearner") });
    const lessons = before.chapters.flatMap((chapter) => chapter.lessons);
    expect(lessons.map((lesson) => lesson.locked)).toEqual([false, true, true]);
    expect(lessons[1]?.lockReason).toBe("sequential");

    await call(
      enrollmentRouter.complete,
      { lessonId: lessonIds[0]!, completed: true },
      { context: ctx("uLearner") },
    );
    const after = await call(lessonRouter.outline, { courseId }, { context: ctx("uLearner") });
    expect(after.chapters.flatMap((chapter) => chapter.lessons).map((l) => l.locked)).toEqual([
      false,
      false,
      true,
    ]);
  });
});
