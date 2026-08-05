ALTER TYPE "wiki"."activity_action" ADD VALUE 'organization.two_factor_enabled' BEFORE 'webhook.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'organization.two_factor_disabled' BEFORE 'webhook.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'organization.two_factor_grace_updated' BEFORE 'webhook.created';--> statement-breakpoint
CREATE TABLE "wiki"."organization_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"two_factor_required" boolean DEFAULT false NOT NULL,
	"two_factor_grace_until" timestamp with time zone,
	"two_factor_require_for_sso" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."organization_setting" ADD CONSTRAINT "organization_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;