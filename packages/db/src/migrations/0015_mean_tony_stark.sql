CREATE TYPE "wiki"."legal_hold_subject" AS ENUM('organization', 'space', 'page');--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.restored' BEFORE 'space.deleted';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.untrashed' BEFORE 'page.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.purged' BEFORE 'page.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'page.untrashed' BEFORE 'comment.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'page.purged' BEFORE 'comment.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'retention.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'retention.purged';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'hold.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'hold.released';--> statement-breakpoint
CREATE TABLE "wiki"."legal_hold" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject" "wiki"."legal_hold_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"released_at" timestamp with time zone,
	"released_by" text,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki"."organization_retention_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"audit_retention_days" integer,
	"trash_retention_days" integer DEFAULT 30 NOT NULL,
	"purge_claimed_at" timestamp with time zone,
	"last_purge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."page" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wiki"."page" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "wiki"."space" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wiki"."space" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "wiki"."legal_hold" ADD CONSTRAINT "legal_hold_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."legal_hold" ADD CONSTRAINT "legal_hold_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."legal_hold" ADD CONSTRAINT "legal_hold_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."organization_retention_setting" ADD CONSTRAINT "organization_retention_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_hold_active_uq" ON "wiki"."legal_hold" USING btree ("subject","subject_id") WHERE released_at IS NULL;--> statement-breakpoint
CREATE INDEX "legal_hold_org_idx" ON "wiki"."legal_hold" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "legal_hold_subject_idx" ON "wiki"."legal_hold" USING btree ("subject","subject_id");--> statement-breakpoint
CREATE INDEX "org_retention_claim_idx" ON "wiki"."organization_retention_setting" USING btree ("purge_claimed_at");--> statement-breakpoint
ALTER TABLE "wiki"."page" ADD CONSTRAINT "page_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."space" ADD CONSTRAINT "space_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_deleted_idx" ON "wiki"."page" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "space_deleted_idx" ON "wiki"."space" USING btree ("deleted_at");