ALTER TABLE "auth"."team" ADD COLUMN "member_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."team_member" ADD COLUMN "membership_key" text;--> statement-breakpoint
ALTER TABLE "auth"."team_member" ADD CONSTRAINT "team_member_membership_key_unique" UNIQUE("membership_key");--> statement-breakpoint
-- Backfill. The column defaults to 0, and Better Auth only ever increments and
-- decrements it from there — so without this every team that already exists
-- would report zero members for good, no matter how many it has.
UPDATE "auth"."team" AS t
SET "member_count" = (
  SELECT count(*) FROM "auth"."team_member" AS m WHERE m."team_id" = t."id"
);
