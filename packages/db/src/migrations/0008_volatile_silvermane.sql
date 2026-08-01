CREATE TABLE "wiki"."page_external_link" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."page_external_link" ADD CONSTRAINT "page_external_link_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "wiki"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."page_external_link" ADD CONSTRAINT "page_external_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_external_link_uq" ON "wiki"."page_external_link" USING btree ("page_id","url");--> statement-breakpoint
CREATE INDEX "page_external_link_page_idx" ON "wiki"."page_external_link" USING btree ("page_id","position");