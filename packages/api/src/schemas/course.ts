import { z } from "zod";

import { IdSchema } from "./shared";

/**
 * Course I/O contracts. Hand-written rather than derived from the drizzle table
 * so the wire format is a decision, not a leak — `yjs_state`, search vectors and
 * the plaintext projections stay server-side.
 */

export const CourseStatusSchema = z.enum(["draft", "published", "archived"]);
export const CourseVisibilitySchema = z.enum(["private", "organization", "public"]);
export const EnrollmentPolicySchema = z.enum(["open", "request", "invite", "paid"]);
export const CourseLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const CourseRoleSchema = z.enum(["reviewer", "assistant", "instructor", "owner"]);
export const PermissionSubjectSchema = z.enum(["user", "team", "role"]);

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug");

/**
 * What the caller may do with a course, resolved server-side and sent with the
 * row. The client mirrors permission logic for affordances, but never decides
 * it: every value here comes from the same resolver the handlers gate on.
 */
export const CourseAccessSchema = z.object({
  canView: z.boolean(),
  canLearn: z.boolean(),
  role: CourseRoleSchema.nullable(),
  canAuthor: z.boolean(),
  canGrade: z.boolean(),
  canManage: z.boolean(),
});

export const CourseSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  slug: z.string(),
  title: z.string(),
  tagline: z.string().nullable(),
  description: z.unknown().nullable(),
  thumbnailAssetId: IdSchema.nullable(),
  /** Ready-to-use image URL, or null when no thumbnail is set. */
  thumbnailUrl: z.string().nullable(),
  status: CourseStatusSchema,
  visibility: CourseVisibilitySchema,
  enrollmentPolicy: EnrollmentPolicySchema,
  level: CourseLevelSchema.nullable(),
  language: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  sequential: z.boolean(),
  completionThreshold: z.number().int(),
  certificateEnabled: z.boolean(),
  enrollmentClosesAt: z.date().nullable(),
  maxSeats: z.number().int().nullable(),
  createdBy: IdSchema.nullable(),
  publishedAt: z.date().nullable(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Course = z.infer<typeof CourseSchema>;

/** A course as it appears in the catalog: counts and the caller's own state. */
export const CourseCardSchema = CourseSchema.extend({
  lessonCount: z.number().int(),
  enrollmentCount: z.number().int(),
  averageRating: z.number().nullable(),
  reviewCount: z.number().int(),
  topics: z.array(z.object({ id: IdSchema, name: z.string(), color: z.string().nullable() })),
  /** The caller's enrolment, when they have one. */
  enrollment: z
    .object({
      id: IdSchema,
      status: z.enum(["pending", "active", "completed", "dropped"]),
      progressPercent: z.number().int(),
      lastLessonId: IdSchema.nullable(),
    })
    .nullable(),
  access: CourseAccessSchema,
});
export type CourseCard = z.infer<typeof CourseCardSchema>;

/** The full landing page: the card plus the authors and the price. */
export const CourseDetailSchema = CourseCardSchema.extend({
  authors: z.array(
    z.object({
      id: IdSchema,
      userId: IdSchema.nullable(),
      name: z.string(),
      image: z.string().nullable(),
      role: CourseRoleSchema,
    }),
  ),
  price: z
    .object({
      productId: IdSchema,
      priceId: IdSchema,
      amountCents: z.number().int(),
      currency: z.string(),
      interval: z.enum(["one_time", "month", "year"]),
    })
    .nullable(),
  /** Why the caller can or cannot enrol right now — rendered verbatim. */
  enrollability: z.object({
    allowed: z.boolean(),
    reason: z.enum([
      "ok",
      "approval_required",
      "already_enrolled",
      "not_visible",
      "not_published",
      "closed",
      "full",
      "invite_only",
      "payment_required",
    ]),
  }),
  seatsLeft: z.number().int().nullable(),
});

export const ListCoursesInputSchema = z.object({
  /** Free-text filter over title and tagline. */
  query: z.string().max(200).optional(),
  topicId: IdSchema.optional(),
  level: CourseLevelSchema.optional(),
  status: CourseStatusSchema.optional(),
  /** Only courses the caller is enrolled in ("my learning"). */
  enrolledOnly: z.boolean().default(false),
  /** Only courses the caller is staff on ("teaching"). */
  authoredOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CreateCourseInputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: SlugSchema.optional(),
  tagline: z.string().max(300).nullish(),
  description: z.unknown().nullish(),
  visibility: CourseVisibilitySchema.default("private"),
  enrollmentPolicy: EnrollmentPolicySchema.default("invite"),
  level: CourseLevelSchema.nullish(),
  language: z.string().max(20).nullish(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullish(),
});

export const UpdateCourseInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  slug: SlugSchema.optional(),
  tagline: z.string().max(300).nullish(),
  description: z.unknown().nullish(),
  thumbnailAssetId: IdSchema.nullish(),
  visibility: CourseVisibilitySchema.optional(),
  enrollmentPolicy: EnrollmentPolicySchema.optional(),
  level: CourseLevelSchema.nullish(),
  language: z.string().max(20).nullish(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullish(),
  sequential: z.boolean().optional(),
  completionThreshold: z.number().int().min(1).max(100).optional(),
  certificateEnabled: z.boolean().optional(),
  certificateTemplate: z.unknown().nullish(),
  enrollmentClosesAt: z.coerce.date().nullish(),
  maxSeats: z.number().int().min(1).max(1_000_000).nullish(),
});

// --- Staff ------------------------------------------------------------------

export const CourseMemberSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  subject: PermissionSubjectSchema,
  role: CourseRoleSchema,
  roleName: z.string().nullable(),
  isPublic: z.boolean(),
  user: z
    .object({ id: IdSchema, name: z.string(), email: z.string(), image: z.string().nullable() })
    .nullable(),
  team: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdAt: z.date(),
});

export const AddCourseMemberInputSchema = z
  .object({
    courseId: IdSchema,
    subject: PermissionSubjectSchema,
    userId: IdSchema.optional(),
    teamId: IdSchema.optional(),
    roleName: z.string().min(1).optional(),
    role: CourseRoleSchema.default("instructor"),
    isPublic: z.boolean().default(true),
  })
  .refine(
    (v) => (v.subject === "user" ? !!v.userId : v.subject === "team" ? !!v.teamId : !!v.roleName),
    { message: "Provide userId (user), teamId (team), or roleName (group)" },
  );

export const UpdateCourseMemberInputSchema = z.object({
  id: IdSchema,
  role: CourseRoleSchema.optional(),
  isPublic: z.boolean().optional(),
});

// --- Topics -----------------------------------------------------------------

export const CourseTopicSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  slug: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  courseCount: z.number().int(),
  createdAt: z.date(),
});

export const CreateCourseTopicInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: SlugSchema.optional(),
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color")
    .nullish(),
});

export const SetCourseTopicsInputSchema = z.object({
  courseId: IdSchema,
  topicIds: z.array(IdSchema).max(20),
});

// --- Collections ------------------------------------------------------------

export const CourseCollectionSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnailAssetId: IdSchema.nullable(),
  visibility: CourseVisibilitySchema,
  publishedAt: z.date().nullable(),
  createdBy: IdSchema.nullable(),
  courseCount: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CourseCollectionDetailSchema = CourseCollectionSchema.extend({
  courses: z.array(CourseCardSchema),
});

export const CreateCollectionInputSchema = z.object({
  name: z.string().min(1).max(160),
  slug: SlugSchema.optional(),
  description: z.string().max(2000).nullish(),
  visibility: CourseVisibilitySchema.default("organization"),
});

export const UpdateCollectionInputSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullish(),
  thumbnailAssetId: IdSchema.nullish(),
  visibility: CourseVisibilitySchema.optional(),
  published: z.boolean().optional(),
});

export const CollectionCourseInputSchema = z.object({
  collectionId: IdSchema,
  courseId: IdSchema,
  /** Insert after this course; omit to append. */
  afterCourseId: IdSchema.nullish(),
});

// --- Announcements ----------------------------------------------------------

export const CourseUpdateSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  title: z.string(),
  content: z.unknown().nullable(),
  publishedAt: z.date().nullable(),
  notifyLearners: z.boolean(),
  author: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateCourseUpdateInputSchema = z.object({
  courseId: IdSchema,
  title: z.string().min(1).max(200),
  content: z.unknown().nullish(),
  notifyLearners: z.boolean().default(true),
  publish: z.boolean().default(false),
});

export const EditCourseUpdateInputSchema = z.object({
  id: IdSchema,
  title: z.string().min(1).max(200).optional(),
  content: z.unknown().nullish(),
  notifyLearners: z.boolean().optional(),
  publish: z.boolean().optional(),
});

// --- Reviews ----------------------------------------------------------------

export const CourseReviewSchema = z.object({
  id: IdSchema,
  courseId: IdSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  user: z.object({ id: IdSchema, name: z.string(), image: z.string().nullable() }).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpsertCourseReviewInputSchema = z.object({
  courseId: IdSchema,
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullish(),
});
