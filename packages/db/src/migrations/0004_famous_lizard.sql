ALTER TYPE "wiki"."permission_subject" ADD VALUE 'role';--> statement-breakpoint
ALTER TABLE "wiki"."page_member" ADD COLUMN "role_name" text;--> statement-breakpoint
ALTER TABLE "wiki"."space_member" ADD COLUMN "role_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "page_member_role_uq" ON "wiki"."page_member" USING btree ("page_id","role_name");--> statement-breakpoint
CREATE UNIQUE INDEX "space_member_role_uq" ON "wiki"."space_member" USING btree ("space_id","role_name");