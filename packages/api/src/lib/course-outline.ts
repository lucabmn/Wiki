/**
 * The course outline — the payload the player's sidebar, the progress rail and
 * the course builder all read.
 *
 * The interesting part is *lock resolution*: whether a learner may open a given
 * lesson right now. Three independent rules decide it (publication, drip
 * release, sequential order) and they compose, so they are resolved once here,
 * on the server, and shipped as a boolean plus a reason. A client that decided
 * this for itself would be a client that could be told to stop deciding it.
 *
 * The resolver is pure and this module imports no db, env or auth — the same
 * discipline `access.ts` and `course-access.ts` follow.
 */

export type ProgressStatus = "not_started" | "in_progress" | "completed";
export type LockReason = "none" | "sequential" | "drip" | "not_enrolled";

export type OutlineChapterInput = {
  id: string;
  title: string;
  description: string | null;
  position: string;
  publishedAt: Date | null;
  availableFrom: Date | null;
  dripDelayDays: number | null;
};

export type OutlineLessonInput = {
  id: string;
  chapterId: string;
  title: string;
  slug: string;
  kind: "dynamic" | "video" | "embed" | "document" | "assignment" | "quiz";
  position: string;
  durationSeconds: number | null;
  isRequired: boolean;
  publishedAt: Date | null;
};

export type LessonProgressInput = {
  lessonId: string;
  status: ProgressStatus;
  furthestPercent: number;
  positionSeconds: number;
};

export type OutlineFacts = {
  chapters: OutlineChapterInput[];
  lessons: OutlineLessonInput[];
  progress: LessonProgressInput[];
  /** Staff see drafts and nothing is ever locked for them. */
  isStaff: boolean;
  /**
   * Whether the caller may actually open lessons. False on a landing page the
   * visitor has not enrolled in yet — they still get the full outline, because
   * seeing what a course contains is how one decides to take it, but every row
   * comes back locked.
   */
  canLearn: boolean;
  /** The course's `sequential` flag. */
  sequential: boolean;
  /** When the learner enrolled — the anchor for `dripDelayDays`. */
  enrolledAt: Date | null;
  now: Date;
};

/**
 * When a chapter opens for one learner.
 *
 * The later of the two rules wins: an absolute release date is a statement
 * about the calendar ("this module opens in September") and a drip delay is a
 * statement about the learner ("a week after you start"), and honouring only
 * one of them would let a course break either promise.
 */
export function chapterAvailableAt(
  chapter: Pick<OutlineChapterInput, "availableFrom" | "dripDelayDays">,
  enrolledAt: Date | null,
): Date | null {
  const dripAt =
    chapter.dripDelayDays !== null && enrolledAt
      ? new Date(enrolledAt.getTime() + chapter.dripDelayDays * 24 * 60 * 60 * 1000)
      : null;
  if (!chapter.availableFrom) return dripAt;
  if (!dripAt) return chapter.availableFrom;
  return chapter.availableFrom > dripAt ? chapter.availableFrom : dripAt;
}

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export type ResolvedOutline = {
  courseId: string;
  isStaff: boolean;
  totalLessons: number;
  requiredLessons: number;
  completedLessons: number;
  progressPercent: number;
  nextLessonId: string | null;
  chapters: {
    id: string;
    title: string;
    description: string | null;
    position: string;
    published: boolean;
    locked: boolean;
    availableAt: Date | null;
    lessons: {
      id: string;
      title: string;
      slug: string;
      kind: OutlineLessonInput["kind"];
      position: string;
      durationSeconds: number | null;
      isRequired: boolean;
      published: boolean;
      status: ProgressStatus;
      furthestPercent: number;
      positionSeconds: number;
      locked: boolean;
      lockReason: LockReason;
      availableAt: Date | null;
    }[];
  }[];
};

/** Builds the outline and resolves every lock. Pure. */
export function resolveOutline(courseId: string, facts: OutlineFacts): ResolvedOutline {
  const progressByLesson = new Map(facts.progress.map((row) => [row.lessonId, row]));

  // Learners never receive unpublished material — not locked, absent. A lock is
  // a promise that something opens later; a draft carries no such promise.
  const chapters = facts.chapters
    .filter((chapter) => facts.isStaff || chapter.publishedAt !== null)
    .sort(byPosition);
  const lessonsByChapter = new Map<string, OutlineLessonInput[]>();
  for (const lesson of facts.lessons) {
    if (!facts.isStaff && lesson.publishedAt === null) continue;
    const list = lessonsByChapter.get(lesson.chapterId) ?? [];
    list.push(lesson);
    lessonsByChapter.set(lesson.chapterId, list);
  }
  for (const list of lessonsByChapter.values()) list.sort(byPosition);

  let totalLessons = 0;
  let requiredLessons = 0;
  let completedLessons = 0;
  // Walks the whole course in reading order, so the sequential rule sees the
  // lessons of earlier chapters and not only of the current one.
  let blockedBySequence = false;
  let nextLessonId: string | null = null;

  const resolvedChapters = chapters.map((chapter) => {
    const availableAt = facts.isStaff ? null : chapterAvailableAt(chapter, facts.enrolledAt);
    const dripLocked = availableAt !== null && availableAt > facts.now;

    const lessons = (lessonsByChapter.get(chapter.id) ?? []).map((lesson) => {
      const progress = progressByLesson.get(lesson.id);
      const status = progress?.status ?? "not_started";
      totalLessons += 1;
      if (lesson.isRequired) requiredLessons += 1;
      if (status === "completed") {
        completedLessons += 1;
      }

      let locked = false;
      let lockReason: LockReason = "none";
      if (!facts.isStaff) {
        if (!facts.canLearn) {
          locked = true;
          lockReason = "not_enrolled";
        } else if (dripLocked) {
          locked = true;
          lockReason = "drip";
        } else if (blockedBySequence) {
          locked = true;
          lockReason = "sequential";
        }
      }

      // A required lesson that is not finished closes everything after it, but
      // only once we have passed it — the lesson itself stays open.
      if (facts.sequential && !facts.isStaff && lesson.isRequired && status !== "completed") {
        blockedBySequence = true;
      }

      if (!locked && status !== "completed" && nextLessonId === null) {
        nextLessonId = lesson.id;
      }

      return {
        id: lesson.id,
        title: lesson.title,
        slug: lesson.slug,
        kind: lesson.kind,
        position: lesson.position,
        durationSeconds: lesson.durationSeconds,
        isRequired: lesson.isRequired,
        published: lesson.publishedAt !== null,
        status,
        furthestPercent: progress?.furthestPercent ?? 0,
        positionSeconds: progress?.positionSeconds ?? 0,
        locked,
        lockReason,
        availableAt: dripLocked ? availableAt : null,
      };
    });

    return {
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      position: chapter.position,
      published: chapter.publishedAt !== null,
      locked: dripLocked,
      availableAt: dripLocked ? availableAt : null,
      lessons,
    };
  });

  return {
    courseId,
    isStaff: facts.isStaff,
    totalLessons,
    requiredLessons,
    completedLessons,
    progressPercent: completionPercent(resolvedChapters),
    nextLessonId,
    chapters: resolvedChapters,
  };
}

/**
 * Completion as a whole number.
 *
 * Counted over the *required* lessons, because optional material must not make
 * a finished course look unfinished. A course with nothing required falls back
 * to counting everything, so the number still moves.
 */
function completionPercent(chapters: ResolvedOutline["chapters"]): number {
  const lessons = chapters.flatMap((chapter) => chapter.lessons);
  const counted = lessons.filter((lesson) => lesson.isRequired);
  const pool = counted.length > 0 ? counted : lessons;
  if (pool.length === 0) return 0;
  const done = pool.filter((lesson) => lesson.status === "completed").length;
  return Math.round((done / pool.length) * 100);
}
