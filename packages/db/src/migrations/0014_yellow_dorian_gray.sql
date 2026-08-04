CREATE SCHEMA "admin";
--> statement-breakpoint
CREATE TYPE "admin"."admin_audit_action" AS ENUM('user.created', 'user.role_changed', 'user.banned', 'user.unbanned', 'user.deleted', 'user.password_set', 'user.password_reset_requested', 'session.revoked', 'session.revoked_all', 'impersonation.started', 'impersonation.ended');--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'impersonation.started';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'impersonation.ended';--> statement-breakpoint
CREATE TABLE "admin"."admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"target_user_id" text,
	"target_email" text,
	"action" "admin"."admin_audit_action" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."activity" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "admin"."admin_audit" ADD CONSTRAINT "admin_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."admin_audit" ADD CONSTRAINT "admin_audit_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin"."admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin"."admin_audit" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_actor_idx" ON "admin"."admin_audit" USING btree ("actor_id");--> statement-breakpoint
ALTER TABLE "wiki"."activity" ADD CONSTRAINT "activity_impersonated_by_user_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;