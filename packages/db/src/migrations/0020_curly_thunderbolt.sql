CREATE SCHEMA "learn";
--> statement-breakpoint
CREATE TYPE "learn"."assignment_task_kind" AS ENUM('file', 'text', 'quiz');--> statement-breakpoint
CREATE TYPE "learn"."certificate_status" AS ENUM('issued', 'revoked');--> statement-breakpoint
CREATE TYPE "learn"."course_asset_kind" AS ENUM('thumbnail', 'video', 'document', 'submission', 'other');--> statement-breakpoint
CREATE TYPE "learn"."course_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "learn"."course_role" AS ENUM('reviewer', 'assistant', 'instructor', 'owner');--> statement-breakpoint
CREATE TYPE "learn"."course_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "learn"."course_visibility" AS ENUM('private', 'organization', 'public');--> statement-breakpoint
CREATE TYPE "learn"."enrollment_policy" AS ENUM('open', 'request', 'invite', 'paid');--> statement-breakpoint
CREATE TYPE "learn"."enrollment_source" AS ENUM('self', 'invite', 'purchase', 'import');--> statement-breakpoint
CREATE TYPE "learn"."enrollment_status" AS ENUM('pending', 'active', 'completed', 'dropped');--> statement-breakpoint
CREATE TYPE "learn"."entitlement_source" AS ENUM('purchase', 'grant');--> statement-breakpoint
CREATE TYPE "learn"."grading_method" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "learn"."permission_subject" AS ENUM('user', 'team', 'role');--> statement-breakpoint
CREATE TYPE "learn"."lesson_kind" AS ENUM('dynamic', 'video', 'embed', 'document', 'assignment', 'quiz');--> statement-breakpoint
CREATE TYPE "learn"."price_interval" AS ENUM('one_time', 'month', 'year');--> statement-breakpoint
CREATE TYPE "learn"."product_kind" AS ENUM('course', 'collection');--> statement-breakpoint
CREATE TYPE "learn"."progress_status" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "learn"."purchase_status" AS ENUM('pending', 'paid', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "learn"."quiz_answer_reveal" AS ENUM('never', 'after_attempt', 'after_pass');--> statement-breakpoint
CREATE TYPE "learn"."quiz_question_kind" AS ENUM('single_choice', 'multiple_choice', 'true_false', 'short_answer');--> statement-breakpoint
CREATE TYPE "learn"."submission_status" AS ENUM('draft', 'submitted', 'returned', 'graded');--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.published';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.archived';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.restored';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.untrashed';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.purged';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.member_added';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.member_role_changed';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'course.member_removed';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'chapter.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'chapter.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'chapter.moved';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'chapter.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'lesson.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'lesson.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'lesson.published';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'lesson.moved';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'lesson.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'collection.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'collection.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'collection.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'enrollment.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'enrollment.approved';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'enrollment.completed';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'enrollment.dropped';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'assignment.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'assignment.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'assignment.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'submission.submitted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'submission.graded';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'submission.returned';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'quiz.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'quiz.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'quiz.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'certificate.issued';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'certificate.revoked';--> statement-breakpoint
CREATE TABLE "learn"."assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"title" text NOT NULL,
	"instructions" jsonb,
	"instructions_text" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"max_grade" integer DEFAULT 100 NOT NULL,
	"passing_grade" integer DEFAULT 60 NOT NULL,
	"grading_method" "learn"."grading_method" DEFAULT 'manual' NOT NULL,
	"allow_late_submission" boolean DEFAULT true NOT NULL,
	"max_attempts" integer,
	"blind_grading" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."assignment_task" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"kind" "learn"."assignment_task_kind" DEFAULT 'text' NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"position" text DEFAULT 'a0' NOT NULL,
	"max_grade" integer DEFAULT 100 NOT NULL,
	"quiz_id" text,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."submission" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" "learn"."submission_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"score" integer,
	"max_score" integer,
	"passed" boolean,
	"feedback" jsonb,
	"feedback_text" text DEFAULT '' NOT NULL,
	"graded_by" text,
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."submission_grade" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"version" integer NOT NULL,
	"score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"passed" boolean NOT NULL,
	"feedback_text" text DEFAULT '' NOT NULL,
	"graded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."submission_task" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"task_id" text NOT NULL,
	"content" jsonb,
	"content_text" text DEFAULT '' NOT NULL,
	"asset_id" text,
	"quiz_attempt_id" text,
	"score" integer,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."certificate" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"course_id" text,
	"enrollment_id" text,
	"user_id" text,
	"serial" text NOT NULL,
	"subject" jsonb NOT NULL,
	"status" "learn"."certificate_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."chapter" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" text DEFAULT 'a0' NOT NULL,
	"available_from" timestamp with time zone,
	"drip_delay_days" integer,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"kind" "learn"."lesson_kind" DEFAULT 'dynamic' NOT NULL,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"slug" text NOT NULL,
	"position" text DEFAULT 'a0' NOT NULL,
	"content" jsonb,
	"text_content" text DEFAULT '' NOT NULL,
	"yjs_state" "bytea",
	"asset_id" text,
	"embed_url" text,
	"duration_seconds" integer,
	"is_required" boolean DEFAULT true NOT NULL,
	"auto_complete_at_percent" integer,
	"created_by" text,
	"last_edited_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" "learn"."entitlement_source" DEFAULT 'purchase' NOT NULL,
	"purchase_id" text,
	"granted_by" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "learn"."product_kind" NOT NULL,
	"course_id" text,
	"collection_id" text,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."product_price" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"amount_cents" integer NOT NULL,
	"interval" "learn"."price_interval" DEFAULT 'one_time' NOT NULL,
	"external_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"price_id" text,
	"user_id" text NOT NULL,
	"status" "learn"."purchase_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."collection_course" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"course_id" text NOT NULL,
	"position" text DEFAULT 'a0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text,
	"description" jsonb,
	"text_content" text DEFAULT '' NOT NULL,
	"thumbnail_asset_id" text,
	"status" "learn"."course_status" DEFAULT 'draft' NOT NULL,
	"visibility" "learn"."course_visibility" DEFAULT 'private' NOT NULL,
	"enrollment_policy" "learn"."enrollment_policy" DEFAULT 'invite' NOT NULL,
	"level" "learn"."course_level",
	"language" text,
	"estimated_minutes" integer,
	"sequential" boolean DEFAULT false NOT NULL,
	"completion_threshold" integer DEFAULT 100 NOT NULL,
	"certificate_enabled" boolean DEFAULT false NOT NULL,
	"certificate_template" jsonb,
	"enrollment_closes_at" timestamp with time zone,
	"max_seats" integer,
	"created_by" text,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('german', coalesce("learn"."course"."title", '')), 'A') || setweight(to_tsvector('german', coalesce("learn"."course"."tagline", '')), 'B') || setweight(to_tsvector('german', coalesce("learn"."course"."text_content", '')), 'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "learn"."course_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"course_id" text,
	"kind" "learn"."course_asset_kind" DEFAULT 'other' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text,
	"uploaded_by" text,
	"deletion_pending_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course_collection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"thumbnail_asset_id" text,
	"visibility" "learn"."course_visibility" DEFAULT 'organization' NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course_member" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"subject" "learn"."permission_subject" NOT NULL,
	"user_id" text,
	"team_id" text,
	"role_name" text,
	"role" "learn"."course_role" DEFAULT 'instructor' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course_review" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course_topic" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course_topic_link" (
	"course_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."course_update" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb,
	"text_content" text DEFAULT '' NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"notify_learners" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."chapter_release" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"releases_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "learn"."enrollment_status" DEFAULT 'active' NOT NULL,
	"source" "learn"."enrollment_source" DEFAULT 'self' NOT NULL,
	"invited_by" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"last_lesson_id" text,
	"last_activity_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."lesson_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"status" "learn"."progress_status" DEFAULT 'in_progress' NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"furthest_percent" integer DEFAULT 0 NOT NULL,
	"seconds_spent" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."quiz" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"passing_percent" integer DEFAULT 70 NOT NULL,
	"max_attempts" integer,
	"time_limit_minutes" integer,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"shuffle_options" boolean DEFAULT false NOT NULL,
	"answer_reveal" "learn"."quiz_answer_reveal" DEFAULT 'after_attempt' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."quiz_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"quiz_id" text NOT NULL,
	"user_id" text NOT NULL,
	"lesson_id" text,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"max_score" integer DEFAULT 0 NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."quiz_option" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"label" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"position" text DEFAULT 'a0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."quiz_question" (
	"id" text PRIMARY KEY NOT NULL,
	"quiz_id" text NOT NULL,
	"kind" "learn"."quiz_question_kind" DEFAULT 'single_choice' NOT NULL,
	"prompt" jsonb,
	"prompt_text" text DEFAULT '' NOT NULL,
	"explanation" text,
	"points" integer DEFAULT 1 NOT NULL,
	"position" text DEFAULT 'a0' NOT NULL,
	"accepted_answers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn"."quiz_response" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"selected_option_ids" jsonb,
	"text_answer" text,
	"is_correct" boolean DEFAULT false NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."activity" ADD COLUMN "course_id" text;--> statement-breakpoint
ALTER TABLE "learn"."assignment" ADD CONSTRAINT "assignment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment" ADD CONSTRAINT "assignment_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "learn"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment_task" ADD CONSTRAINT "assignment_task_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."assignment_task" ADD CONSTRAINT "assignment_task_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "learn"."quiz"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission" ADD CONSTRAINT "submission_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "learn"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission" ADD CONSTRAINT "submission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission" ADD CONSTRAINT "submission_graded_by_user_id_fk" FOREIGN KEY ("graded_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission_grade" ADD CONSTRAINT "submission_grade_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "learn"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission_grade" ADD CONSTRAINT "submission_grade_graded_by_user_id_fk" FOREIGN KEY ("graded_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission_task" ADD CONSTRAINT "submission_task_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "learn"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission_task" ADD CONSTRAINT "submission_task_task_id_assignment_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "learn"."assignment_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission_task" ADD CONSTRAINT "submission_task_asset_id_course_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "learn"."course_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."submission_task" ADD CONSTRAINT "submission_task_quiz_attempt_id_quiz_attempt_id_fk" FOREIGN KEY ("quiz_attempt_id") REFERENCES "learn"."quiz_attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate" ADD CONSTRAINT "certificate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate" ADD CONSTRAINT "certificate_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate" ADD CONSTRAINT "certificate_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "learn"."enrollment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate" ADD CONSTRAINT "certificate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."certificate" ADD CONSTRAINT "certificate_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."chapter" ADD CONSTRAINT "chapter_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson" ADD CONSTRAINT "lesson_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson" ADD CONSTRAINT "lesson_chapter_id_chapter_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "learn"."chapter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson" ADD CONSTRAINT "lesson_asset_id_course_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "learn"."course_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson" ADD CONSTRAINT "lesson_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson" ADD CONSTRAINT "lesson_last_edited_by_user_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."entitlement" ADD CONSTRAINT "entitlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."entitlement" ADD CONSTRAINT "entitlement_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "learn"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."entitlement" ADD CONSTRAINT "entitlement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."entitlement" ADD CONSTRAINT "entitlement_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "learn"."purchase"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."entitlement" ADD CONSTRAINT "entitlement_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."product" ADD CONSTRAINT "product_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."product" ADD CONSTRAINT "product_collection_id_course_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "learn"."course_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."product_price" ADD CONSTRAINT "product_price_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "learn"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."purchase" ADD CONSTRAINT "purchase_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."purchase" ADD CONSTRAINT "purchase_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "learn"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."purchase" ADD CONSTRAINT "purchase_price_id_product_price_id_fk" FOREIGN KEY ("price_id") REFERENCES "learn"."product_price"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."purchase" ADD CONSTRAINT "purchase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."collection_course" ADD CONSTRAINT "collection_course_collection_id_course_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "learn"."course_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."collection_course" ADD CONSTRAINT "collection_course_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course" ADD CONSTRAINT "course_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course" ADD CONSTRAINT "course_thumbnail_asset_id_course_asset_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "learn"."course_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course" ADD CONSTRAINT "course_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course" ADD CONSTRAINT "course_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_asset" ADD CONSTRAINT "course_asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_asset" ADD CONSTRAINT "course_asset_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_asset" ADD CONSTRAINT "course_asset_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_collection" ADD CONSTRAINT "course_collection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_collection" ADD CONSTRAINT "course_collection_thumbnail_asset_id_course_asset_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "learn"."course_asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_collection" ADD CONSTRAINT "course_collection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_member" ADD CONSTRAINT "course_member_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_member" ADD CONSTRAINT "course_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_member" ADD CONSTRAINT "course_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "auth"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_review" ADD CONSTRAINT "course_review_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_review" ADD CONSTRAINT "course_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_topic" ADD CONSTRAINT "course_topic_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_topic_link" ADD CONSTRAINT "course_topic_link_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_topic_link" ADD CONSTRAINT "course_topic_link_topic_id_course_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "learn"."course_topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_update" ADD CONSTRAINT "course_update_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."course_update" ADD CONSTRAINT "course_update_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."chapter_release" ADD CONSTRAINT "chapter_release_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "learn"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."chapter_release" ADD CONSTRAINT "chapter_release_chapter_id_chapter_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "learn"."chapter"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."enrollment" ADD CONSTRAINT "enrollment_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."enrollment" ADD CONSTRAINT "enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."enrollment" ADD CONSTRAINT "enrollment_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."enrollment" ADD CONSTRAINT "enrollment_last_lesson_id_lesson_id_fk" FOREIGN KEY ("last_lesson_id") REFERENCES "learn"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_id_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "learn"."enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "learn"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz" ADD CONSTRAINT "quiz_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_attempt" ADD CONSTRAINT "quiz_attempt_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "learn"."quiz"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_attempt" ADD CONSTRAINT "quiz_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_attempt" ADD CONSTRAINT "quiz_attempt_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "learn"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_option" ADD CONSTRAINT "quiz_option_question_id_quiz_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "learn"."quiz_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_question" ADD CONSTRAINT "quiz_question_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "learn"."quiz"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_response" ADD CONSTRAINT "quiz_response_attempt_id_quiz_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "learn"."quiz_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learn"."quiz_response" ADD CONSTRAINT "quiz_response_question_id_quiz_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "learn"."quiz_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_lesson_uq" ON "learn"."assignment" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "assignment_course_idx" ON "learn"."assignment" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "assignment_due_idx" ON "learn"."assignment" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "assignment_task_assignment_idx" ON "learn"."assignment_task" USING btree ("assignment_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_attempt_uq" ON "learn"."submission" USING btree ("assignment_id","user_id","attempt_number");--> statement-breakpoint
CREATE INDEX "submission_assignment_status_idx" ON "learn"."submission" USING btree ("assignment_id","status");--> statement-breakpoint
CREATE INDEX "submission_user_idx" ON "learn"."submission" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_grade_uq" ON "learn"."submission_grade" USING btree ("submission_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_task_uq" ON "learn"."submission_task" USING btree ("submission_id","task_id");--> statement-breakpoint
CREATE INDEX "submission_task_task_idx" ON "learn"."submission_task" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_serial_uq" ON "learn"."certificate" USING btree ("serial");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_enrollment_uq" ON "learn"."certificate" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "certificate_user_idx" ON "learn"."certificate" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "certificate_course_idx" ON "learn"."certificate" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "chapter_course_position_idx" ON "learn"."chapter" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "chapter_course_idx" ON "learn"."chapter" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_course_slug_uq" ON "learn"."lesson" USING btree ("course_id","slug");--> statement-breakpoint
CREATE INDEX "lesson_chapter_position_idx" ON "learn"."lesson" USING btree ("chapter_id","position");--> statement-breakpoint
CREATE INDEX "lesson_course_idx" ON "learn"."lesson" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "lesson_kind_idx" ON "learn"."lesson" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_user_product_uq" ON "learn"."entitlement" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "entitlement_product_idx" ON "learn"."entitlement" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_course_uq" ON "learn"."product" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_collection_uq" ON "learn"."product" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "product_org_idx" ON "learn"."product" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "product_price_product_idx" ON "learn"."product_price" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_provider_external_uq" ON "learn"."purchase" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "purchase_user_idx" ON "learn"."purchase" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchase_product_idx" ON "learn"."purchase" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_course_uq" ON "learn"."collection_course" USING btree ("collection_id","course_id");--> statement-breakpoint
CREATE INDEX "collection_course_course_idx" ON "learn"."collection_course" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_org_slug_uq" ON "learn"."course" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "course_org_status_idx" ON "learn"."course" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "course_visibility_idx" ON "learn"."course" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "course_created_by_idx" ON "learn"."course" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "course_deleted_idx" ON "learn"."course" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "course_search_idx" ON "learn"."course" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "course_asset_course_idx" ON "learn"."course_asset" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "course_asset_org_idx" ON "learn"."course_asset" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "course_asset_uploaded_by_idx" ON "learn"."course_asset" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "course_collection_org_slug_uq" ON "learn"."course_collection" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "course_collection_org_idx" ON "learn"."course_collection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_member_user_uq" ON "learn"."course_member" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_member_team_uq" ON "learn"."course_member" USING btree ("course_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_member_role_uq" ON "learn"."course_member" USING btree ("course_id","role_name");--> statement-breakpoint
CREATE INDEX "course_member_course_idx" ON "learn"."course_member" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "course_member_user_idx" ON "learn"."course_member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_review_uq" ON "learn"."course_review" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "course_review_course_idx" ON "learn"."course_review" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_topic_org_slug_uq" ON "learn"."course_topic" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "course_topic_org_idx" ON "learn"."course_topic" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_topic_link_uq" ON "learn"."course_topic_link" USING btree ("course_id","topic_id");--> statement-breakpoint
CREATE INDEX "course_topic_link_topic_idx" ON "learn"."course_topic_link" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "course_update_course_idx" ON "learn"."course_update" USING btree ("course_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_release_uq" ON "learn"."chapter_release" USING btree ("enrollment_id","chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_release_chapter_idx" ON "learn"."chapter_release" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_course_user_uq" ON "learn"."enrollment" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "enrollment_user_status_idx" ON "learn"."enrollment" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "enrollment_course_status_idx" ON "learn"."enrollment" USING btree ("course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_progress_uq" ON "learn"."lesson_progress" USING btree ("enrollment_id","lesson_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_lesson_idx" ON "learn"."lesson_progress" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_status_idx" ON "learn"."lesson_progress" USING btree ("enrollment_id","status");--> statement-breakpoint
CREATE INDEX "quiz_course_idx" ON "learn"."quiz" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempt_uq" ON "learn"."quiz_attempt" USING btree ("quiz_id","user_id","attempt_number");--> statement-breakpoint
CREATE INDEX "quiz_attempt_user_idx" ON "learn"."quiz_attempt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quiz_attempt_quiz_idx" ON "learn"."quiz_attempt" USING btree ("quiz_id");--> statement-breakpoint
CREATE INDEX "quiz_option_question_idx" ON "learn"."quiz_option" USING btree ("question_id","position");--> statement-breakpoint
CREATE INDEX "quiz_question_quiz_idx" ON "learn"."quiz_question" USING btree ("quiz_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_response_uq" ON "learn"."quiz_response" USING btree ("attempt_id","question_id");--> statement-breakpoint
ALTER TABLE "wiki"."activity" ADD CONSTRAINT "activity_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "learn"."course"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_course_idx" ON "wiki"."activity" USING btree ("course_id");