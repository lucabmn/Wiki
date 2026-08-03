ALTER TABLE "wiki"."attachment" ADD COLUMN "deletion_pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wiki"."space" ADD COLUMN "deletion_pending_at" timestamp with time zone;