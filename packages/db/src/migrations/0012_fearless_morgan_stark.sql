CREATE TYPE "wiki"."digest_category" AS ENUM('pages_created', 'pages_updated', 'pages_removed', 'comments', 'attachments', 'spaces');--> statement-breakpoint
CREATE TYPE "wiki"."digest_frequency" AS ENUM('off', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "wiki"."digest_mode" AS ENUM('inherit', 'custom');--> statement-breakpoint
CREATE TYPE "wiki"."digest_scope" AS ENUM('organization', 'my_spaces', 'subscribed');--> statement-breakpoint
CREATE TABLE "wiki"."digest_delivery" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"cursor_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_delivery_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "wiki"."organization_digest_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"frequency" "wiki"."digest_frequency" DEFAULT 'weekly' NOT NULL,
	"hour" integer DEFAULT 8 NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"categories" "wiki"."digest_category"[] DEFAULT '{"pages_created","pages_updated","comments"}' NOT NULL,
	"scope" "wiki"."digest_scope" DEFAULT 'organization' NOT NULL,
	"skip_if_empty" boolean DEFAULT true NOT NULL,
	"include_own_activity" boolean DEFAULT false NOT NULL,
	"allow_user_override" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki"."user_digest_setting" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"mode" "wiki"."digest_mode" DEFAULT 'inherit' NOT NULL,
	"frequency" "wiki"."digest_frequency",
	"hour" integer,
	"weekday" integer,
	"day_of_month" integer,
	"timezone" text,
	"categories" "wiki"."digest_category"[],
	"scope" "wiki"."digest_scope",
	"skip_if_empty" boolean,
	"include_own_activity" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_digest_setting_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "wiki"."digest_delivery" ADD CONSTRAINT "digest_delivery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."digest_delivery" ADD CONSTRAINT "digest_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."organization_digest_setting" ADD CONSTRAINT "organization_digest_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."user_digest_setting" ADD CONSTRAINT "user_digest_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."user_digest_setting" ADD CONSTRAINT "user_digest_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digest_delivery_due_idx" ON "wiki"."digest_delivery" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "user_digest_setting_org_idx" ON "wiki"."user_digest_setting" USING btree ("organization_id");