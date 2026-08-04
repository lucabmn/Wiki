CREATE TYPE "wiki"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'webhook.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'webhook.updated';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'webhook.deleted';--> statement-breakpoint
CREATE TABLE "wiki"."webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" "wiki"."activity_action"[] NOT NULL,
	"space_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki"."webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"activity_id" text,
	"status" "wiki"."webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"response_status" integer,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."webhook" ADD CONSTRAINT "webhook_space_id_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "wiki"."space"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."webhook" ADD CONSTRAINT "webhook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "wiki"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "wiki"."activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_org_active_idx" ON "wiki"."webhook" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "wiki"."webhook_delivery" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_idx" ON "wiki"."webhook_delivery" USING btree ("webhook_id","created_at");