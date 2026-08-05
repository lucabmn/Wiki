CREATE TYPE "wiki"."notification_type" AS ENUM('mention_page', 'mention_comment', 'comment_reply');--> statement-breakpoint
CREATE TABLE "wiki"."mention_notice" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"comment_id" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki"."notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" "wiki"."notification_type" NOT NULL,
	"actor_id" text,
	"page_id" text NOT NULL,
	"comment_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki"."organization_direct_notification_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mentions" boolean DEFAULT true NOT NULL,
	"comment_replies" boolean DEFAULT true NOT NULL,
	"allow_user_override" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki"."user_direct_notification_setting" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"mentions" boolean,
	"comment_replies" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_direct_notification_setting_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "wiki"."mention_notice" ADD CONSTRAINT "mention_notice_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "wiki"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."mention_notice" ADD CONSTRAINT "mention_notice_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "wiki"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."mention_notice" ADD CONSTRAINT "mention_notice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."notification" ADD CONSTRAINT "notification_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "wiki"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."notification" ADD CONSTRAINT "notification_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "wiki"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."organization_direct_notification_setting" ADD CONSTRAINT "organization_direct_notification_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."user_direct_notification_setting" ADD CONSTRAINT "user_direct_notification_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."user_direct_notification_setting" ADD CONSTRAINT "user_direct_notification_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mention_notice_page_uq" ON "wiki"."mention_notice" USING btree ("page_id","user_id") WHERE comment_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mention_notice_comment_uq" ON "wiki"."mention_notice" USING btree ("comment_id","user_id") WHERE comment_id is not null;--> statement-breakpoint
CREATE INDEX "mention_notice_page_idx" ON "wiki"."mention_notice" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "wiki"."notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "wiki"."notification" USING btree ("user_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "notification_page_idx" ON "wiki"."notification" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "user_direct_notification_setting_org_idx" ON "wiki"."user_direct_notification_setting" USING btree ("organization_id");