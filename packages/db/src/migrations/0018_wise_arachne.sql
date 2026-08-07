ALTER TYPE "wiki"."activity_action" ADD VALUE 'comment.updated' BEFORE 'comment.resolved';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.member_added' BEFORE 'organization.two_factor_enabled';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.member_role_changed' BEFORE 'organization.two_factor_enabled';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'space.member_removed' BEFORE 'organization.two_factor_enabled';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'page.access_changed' BEFORE 'organization.two_factor_enabled';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'page.member_added' BEFORE 'organization.two_factor_enabled';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'page.member_role_changed' BEFORE 'organization.two_factor_enabled';--> statement-breakpoint
ALTER TYPE "wiki"."activity_action" ADD VALUE 'page.member_removed' BEFORE 'organization.two_factor_enabled';