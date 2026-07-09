CREATE TABLE "wiki"."page_member" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"subject" "wiki"."permission_subject" NOT NULL,
	"user_id" text,
	"team_id" text,
	"role" "wiki"."wiki_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."page" ADD COLUMN "visibility" "wiki"."space_visibility";--> statement-breakpoint
ALTER TABLE "wiki"."page_member" ADD CONSTRAINT "page_member_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "wiki"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."page_member" ADD CONSTRAINT "page_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki"."page_member" ADD CONSTRAINT "page_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "auth"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_member_user_uq" ON "wiki"."page_member" USING btree ("page_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_member_team_uq" ON "wiki"."page_member" USING btree ("page_id","team_id");--> statement-breakpoint
CREATE INDEX "page_member_page_idx" ON "wiki"."page_member" USING btree ("page_id");