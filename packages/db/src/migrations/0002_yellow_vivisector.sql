ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.deleted' BEFORE 'page.created';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'comment.deleted' BEFORE 'attachment.uploaded';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'attachment.deleted';