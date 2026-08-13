import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { id, timestamps, tsvector } from "../_helpers";
import { organization, team, user } from "../auth";
import { learnSchema } from "./_schema";
import {
  courseAssetKind,
  courseLevel,
  courseRole,
  courseStatus,
  courseVisibility,
  enrollmentPolicy,
  learnSubject,
} from "./enums";

/**
 * A course: the unit learners enrol in, staff author, and certificates are
 * issued for. Courses are org-scoped and never live inside a wiki space —
 * the two products share an organization, nothing else.
 */
export const course = learnSchema.table(
  "course",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** One-line pitch shown on catalog cards. Plain text on purpose. */
    tagline: text("tagline"),
    /** Rich landing-page body (TipTap/ProseMirror JSON), same format as pages. */
    description: jsonb("description"),
    /** Plaintext projection of `description`; feeds search and card previews. */
    textContent: text("text_content").notNull().default(""),
    // Lazy reference: `course_asset` points back at `course`, so the two FKs
    // form a cycle. Postgres accepts it because drizzle-kit emits every foreign
    // key as its own ALTER TABLE after all tables exist.
    thumbnailAssetId: text("thumbnail_asset_id").references((): AnyPgColumn => courseAsset.id, {
      onDelete: "set null",
    }),
    status: courseStatus("status").notNull().default("draft"),
    visibility: courseVisibility("visibility").notNull().default("private"),
    enrollmentPolicy: enrollmentPolicy("enrollment_policy").notNull().default("invite"),
    level: courseLevel("level"),
    /** BCP-47 tag. Catalog facet; does not switch the interface language. */
    language: text("language"),
    /** Authoring estimate in minutes; `null` means "sum the lessons". */
    estimatedMinutes: integer("estimated_minutes"),
    /**
     * Learners must finish lesson N before N+1 unlocks. Off by default because
     * enforcing order on an unfinished course locks everyone out of the end.
     */
    sequential: boolean("sequential").notNull().default(false),
    /** Percentage of required lessons needed to count the course as completed. */
    completionThreshold: integer("completion_threshold").notNull().default(100),
    certificateEnabled: boolean("certificate_enabled").notNull().default(false),
    /** Rendering options for the issued certificate (title, signature, …). */
    certificateTemplate: jsonb("certificate_template"),
    /** Enrolment closes after this instant. `null` = always open. */
    enrollmentClosesAt: timestamp("enrollment_closes_at", { withTimezone: true }),
    maxSeats: integer("max_seats"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Same archived/deleted distinction as `wiki.page`: archived is still
    // findable by its learners, deleted is in the trash and gone from every
    // view until it is restored or the retention window expires.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
    // Weighted FTS vector, same 'german' configuration as `wiki.page` so both
    // products answer a query the same way.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('german', coalesce(${course.title}, '')), 'A') || setweight(to_tsvector('german', coalesce(${course.tagline}, '')), 'B') || setweight(to_tsvector('german', coalesce(${course.textContent}, '')), 'C')`,
    ),
  },
  (t) => [
    uniqueIndex("course_org_slug_uq").on(t.organizationId, t.slug),
    index("course_org_status_idx").on(t.organizationId, t.status),
    index("course_visibility_idx").on(t.visibility),
    index("course_created_by_idx").on(t.createdBy),
    index("course_deleted_idx").on(t.deletedAt),
    index("course_search_idx").using("gin", t.searchVector),
  ],
);

/**
 * Staff grants on a course, for a user, a team, or an org group — mirroring
 * `wiki.space_member`. Learners are NOT listed here; see `enrollment`.
 */
export const courseMember = learnSchema.table(
  "course_member",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    subject: learnSubject("subject").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => team.id, { onDelete: "cascade" }),
    /** For subject="role": the org role (group) name this grant applies to. */
    roleName: text("role_name"),
    role: courseRole("role").notNull().default("instructor"),
    /** Shown on the course landing page as a listed author. */
    isPublic: boolean("is_public").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // NULLs are distinct in Postgres, so the three partial-uniqueness rules
    // coexist on one table.
    uniqueIndex("course_member_user_uq").on(t.courseId, t.userId),
    uniqueIndex("course_member_team_uq").on(t.courseId, t.teamId),
    uniqueIndex("course_member_role_uq").on(t.courseId, t.roleName),
    index("course_member_course_idx").on(t.courseId),
    index("course_member_user_idx").on(t.userId),
  ],
);

/**
 * A curated group of courses ("learning path"). Ordering is explicit so a path
 * can prescribe a sequence, and a course may appear in several collections.
 */
export const courseCollection = learnSchema.table(
  "course_collection",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    thumbnailAssetId: text("thumbnail_asset_id").references((): AnyPgColumn => courseAsset.id, {
      onDelete: "set null",
    }),
    visibility: courseVisibility("visibility").notNull().default("organization"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("course_collection_org_slug_uq").on(t.organizationId, t.slug),
    index("course_collection_org_idx").on(t.organizationId),
  ],
);

export const collectionCourse = learnSchema.table(
  "collection_course",
  {
    id: id(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => courseCollection.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    /** Fractional (LexoRank) ordering, seeded "a0" — see api `lib/fractional.ts`. */
    position: text("position").notNull().default("a0"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("collection_course_uq").on(t.collectionId, t.courseId),
    index("collection_course_course_idx").on(t.courseId),
  ],
);

/**
 * Catalog topics. Org-scoped and shared across courses, unlike `wiki.tag`
 * which is scoped to a single space and therefore not reusable here.
 */
export const courseTopic = learnSchema.table(
  "course_topic",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("course_topic_org_slug_uq").on(t.organizationId, t.slug),
    index("course_topic_org_idx").on(t.organizationId),
  ],
);

export const courseTopicLink = learnSchema.table(
  "course_topic_link",
  {
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => courseTopic.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("course_topic_link_uq").on(t.courseId, t.topicId),
    index("course_topic_link_topic_idx").on(t.topicId),
  ],
);

/**
 * An announcement inside a course. Separate from the audit feed: this is
 * written by a human for learners, not derived from a mutation.
 */
export const courseUpdate = learnSchema.table(
  "course_update",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: jsonb("content"),
    textContent: text("text_content").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** Drafts are staff-only until this is set. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Fan the announcement out to every active learner's inbox on publish. */
    notifyLearners: boolean("notify_learners").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("course_update_course_idx").on(t.courseId, t.publishedAt)],
);

/**
 * A learner's rating. One row per user per course; only enrolled users may
 * write one, which is enforced in the API rather than by a constraint because
 * the enrolment can later be dropped without invalidating the review.
 */
export const courseReview = learnSchema.table(
  "course_review",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(), // 1..5, validated in the API layer
    comment: text("comment"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("course_review_uq").on(t.courseId, t.userId),
    index("course_review_course_idx").on(t.courseId),
  ],
);

/**
 * Files owned by the learning product: thumbnails, lesson videos, documents
 * and learner hand-ins.
 *
 * A separate table from `wiki.attachment` because that one is `space_id NOT
 * NULL` — courses have no space, and widening the wiki table would make every
 * attachment query carry a column that is null for most rows. Both use the same
 * object storage helper; only the key prefix differs.
 */
export const courseAsset = learnSchema.table(
  "course_asset",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** null for org-level assets (e.g. a collection thumbnail). */
    courseId: text("course_id").references(() => course.id, { onDelete: "cascade" }),
    kind: courseAssetKind("kind").notNull().default("other"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    checksum: text("checksum"),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    /** Written before object storage is touched so a failed delete is retryable. */
    deletionPendingAt: timestamp("deletion_pending_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("course_asset_course_idx").on(t.courseId),
    index("course_asset_org_idx").on(t.organizationId),
    index("course_asset_uploaded_by_idx").on(t.uploadedBy),
  ],
);
