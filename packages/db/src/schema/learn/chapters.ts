import { boolean, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { bytea, id, timestamps } from "../_helpers";
import { user } from "../auth";
import { learnSchema } from "./_schema";
import { course, courseAsset } from "./courses";
import { lessonKind } from "./enums";

/**
 * A chapter groups lessons. Chapters are ordered fractionally so a reorder
 * writes one row, and they carry the drip settings — release rules apply to a
 * whole chapter, never to a single lesson, because a half-released chapter is
 * indistinguishable from a broken one to the learner.
 */
export const chapter = learnSchema.table(
  "chapter",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** Fractional (LexoRank) ordering among siblings, seeded "a0". */
    position: text("position").notNull().default("a0"),
    /** Absolute release date. Combined with `dripDelayDays`, the later wins. */
    availableFrom: timestamp("available_from", { withTimezone: true }),
    /** Release this many days after the learner enrolled. `null` = immediately. */
    dripDelayDays: integer("drip_delay_days"),
    /** Drafts are staff-only. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("chapter_course_position_idx").on(t.courseId, t.position),
    index("chapter_course_idx").on(t.courseId),
  ],
);

/**
 * A lesson — the atom a learner opens and completes.
 *
 * Called an "activity" in some LMS vocabularies; renamed because `wiki.activity`
 * is this codebase's audit log and one word must not mean two things. The
 * `kind` decides which of the payload columns is meaningful; the API layer
 * validates that pairing so a video lesson can never be saved without a source.
 */
export const lesson = learnSchema.table(
  "lesson",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapter.id, { onDelete: "cascade" }),
    kind: lessonKind("kind").notNull().default("dynamic"),
    title: text("title").notNull().default("Untitled"),
    slug: text("slug").notNull(),
    position: text("position").notNull().default("a0"),

    // ── Payload, by kind ────────────────────────────────────────────────────
    /** kind=dynamic: TipTap/ProseMirror JSON, same format as `wiki.page`. */
    content: jsonb("content"),
    /** Plaintext projection of `content`; feeds search and previews. */
    textContent: text("text_content").notNull().default(""),
    /**
     * Yjs CRDT snapshot for collaborative authoring of a dynamic lesson. Same
     * contract as `wiki.page.yjs_state`: once set, the in-memory shared doc
     * wins and `content` must not be written out of band.
     */
    yjsState: bytea("yjs_state"),
    /** kind=video|document: the uploaded file. */
    assetId: text("asset_id").references(() => courseAsset.id, { onDelete: "set null" }),
    /** kind=embed: external URL (YouTube, Vimeo, an iframe-able tool). */
    embedUrl: text("embed_url"),

    /** Playback/reading length, for the course outline and progress estimates. */
    durationSeconds: integer("duration_seconds"),
    /** Optional lessons do not count towards the completion threshold. */
    isRequired: boolean("is_required").notNull().default(true),
    /**
     * Video/document lessons complete themselves once the learner reaches this
     * share of the material. `null` = the learner marks it done by hand.
     */
    autoCompleteAtPercent: integer("auto_complete_at_percent"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    lastEditedBy: text("last_edited_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("lesson_course_slug_uq").on(t.courseId, t.slug),
    index("lesson_chapter_position_idx").on(t.chapterId, t.position),
    index("lesson_course_idx").on(t.courseId),
    index("lesson_kind_idx").on(t.kind),
  ],
);
