import { learnSchema } from "./_schema";

/**
 * Publication lifecycle of a course. Orthogonal to `courseVisibility`: a course
 * can be `published` and still `private`, which means "finished, but only for
 * the people explicitly enrolled".
 */
export const courseStatus = learnSchema.enum("course_status", [
  "draft", // only authors see it; no enrolment possible
  "published", // live, discoverable per `visibility`
  "archived", // read-only for existing learners, hidden from the catalog
]);

/**
 * Who may *see* a course. Read access is resolved from this together with
 * enrolment and authorship — see `packages/api/src/lib/course-access.ts`.
 */
export const courseVisibility = learnSchema.enum("course_visibility", [
  "private", // explicit staff + enrolled learners only
  "organization", // every member of the owning organization can find it
  "public", // readable without a session (catalog + landing page)
]);

/** How a learner gets in. Decides what `enroll` is allowed to do. */
export const enrollmentPolicy = learnSchema.enum("enrollment_policy", [
  "open", // anyone who can see the course may enrol themselves
  "request", // self-enrolment creates a `pending` row an author approves
  "invite", // only staff can add learners
  "paid", // requires an active entitlement for the course's product
]);

/** Catalog facet. Purely descriptive — it never affects access. */
export const courseLevel = learnSchema.enum("course_level", [
  "beginner",
  "intermediate",
  "advanced",
]);

/**
 * Staff roles on a course, ranked. `student` is deliberately absent: learners
 * are represented by an `enrollment` row, not by a staff grant, so that "may
 * edit" and "is taking this" can never be conflated.
 */
export const courseRole = learnSchema.enum("course_role", [
  "reviewer", // read the course and its submissions, no grading
  "assistant", // grade submissions, no authoring
  "instructor", // author content and grade
  "owner", // everything, including deletion and staff management
]);

/** Which subject a `course_member` grant is addressed to (user/team/org group). */
export const learnSubject = learnSchema.enum("permission_subject", ["user", "team", "role"]);

/**
 * What a lesson *is*. Called an "activity" in some LMS vocabularies; renamed
 * here because `wiki.activity` is the audit log and one word cannot mean both.
 */
export const lessonKind = learnSchema.enum("lesson_kind", [
  "dynamic", // rich text authored in the shared TipTap editor
  "video", // uploaded video served from object storage
  "embed", // externally hosted video/iframe (YouTube, Vimeo, …)
  "document", // uploaded PDF / office document
  "assignment", // hand-in with tasks and grading
  "quiz", // graded questionnaire
]);

/** Lifecycle of one learner in one course. */
export const enrollmentStatus = learnSchema.enum("enrollment_status", [
  "pending", // requested, awaiting approval (`enrollment_policy = request`)
  "active",
  "completed",
  "dropped", // left or was removed; progress is kept for re-enrolment
]);

/** How the learner came to be enrolled. Audit trail for billing disputes. */
export const enrollmentSource = learnSchema.enum("enrollment_source", [
  "self",
  "invite",
  "purchase",
  "import",
]);

/** Per-lesson progress. `in_progress` is set on first open, not on first byte. */
export const progressStatus = learnSchema.enum("progress_status", [
  "not_started",
  "in_progress",
  "completed",
]);

/** What one hand-in task asks for. */
export const assignmentTaskKind = learnSchema.enum("assignment_task_kind", [
  "file", // upload one or more files
  "text", // rich-text answer written in place
  "quiz", // answer an attached quiz, auto-graded
]);

/**
 * Lifecycle of a hand-in. `returned` means the grader sent it back for another
 * attempt — distinct from `graded`, which is final.
 */
export const submissionStatus = learnSchema.enum("submission_status", [
  "draft", // started, not handed in; only the learner sees it
  "submitted",
  "returned", // sent back for rework
  "graded",
]);

/** Whether a submission's score is computed or entered by a human. */
export const gradingMethod = learnSchema.enum("grading_method", ["auto", "manual"]);

/** Shape of one quiz question, which decides how it is answered and scored. */
export const quizQuestionKind = learnSchema.enum("quiz_question_kind", [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer", // exact-match against accepted answers
]);

/** When the learner is allowed to see which answers were right. */
export const quizAnswerReveal = learnSchema.enum("quiz_answer_reveal", [
  "never",
  "after_attempt",
  "after_pass",
]);

/** A certificate is issued once and can only ever be revoked, never edited. */
export const certificateStatus = learnSchema.enum("certificate_status", ["issued", "revoked"]);

/** What a stored file is used for. Drives cleanup and access rules. */
export const courseAssetKind = learnSchema.enum("course_asset_kind", [
  "thumbnail",
  "video",
  "document",
  "submission", // learner-uploaded hand-in, visible to its author + graders
  "other",
]);

// ── Commerce ────────────────────────────────────────────────────────────────
// Deliberately provider-agnostic: the tables below model *entitlement*, which
// is what access control asks about. Which payment processor produced a
// purchase is a column, not a schema.

/** What is being sold. */
export const productKind = learnSchema.enum("product_kind", ["course", "collection"]);

/** Billing cadence of a price point. */
export const priceInterval = learnSchema.enum("price_interval", ["one_time", "month", "year"]);

/** Lifecycle of one payment attempt. */
export const purchaseStatus = learnSchema.enum("purchase_status", [
  "pending",
  "paid",
  "refunded",
  "failed",
]);

/** Why someone holds an entitlement — bought it, or was given it. */
export const entitlementSource = learnSchema.enum("entitlement_source", [
  "purchase",
  "grant", // handed out by an admin, e.g. a seat included in a plan
]);
